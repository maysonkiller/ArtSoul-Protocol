/* ArtSoul Voice R2: a bounded, read-only contextual intent layer.
 * It selects existing WebMCP tools. It neither signs nor grants wallet access. */
(function () {
    'use strict';
    const id = x => typeof x === 'string' && /^[1-9]\d{0,77}$/.test(x) && BigInt(x) < (1n<<256n) ? x : null;
    const clean = x => typeof x === 'string' ? x.trim().replace(/\s+/g,' ').slice(0,300) : '';
    function createDialogue(now=()=>Date.now()) {
        let last=null, list=[], updated=now();
        const touch=()=>{if(now()<updated||now()-updated>900000)clear();updated=now();};
        function clear(){last=null;list=[];updated=now();}
        function observe(tool,result){
            if(!result||typeof result!=='object'||Array.isArray(result)||result.error||result.opened===false||result.prepared===false||result.submitted===false||result.updated===false||result.confirmed===false)return;
            touch();
            if(tool==='find_active_auctions'){
                // Malformed auction responses must never preserve stale selections.
                if(!Array.isArray(result.auctions)||!Number.isSafeInteger(result.count)||
                    result.count<0||result.count<result.auctions.length){
                    list=[];last=null;return;
                }
                const parsed=result.auctions.slice(0,12).map(a=>{
                    const artwork=id(a?.artwork_id),hours=a?.hours_remaining;
                    return artwork&&typeof hours==='number'&&Number.isFinite(hours)&&hours>=0
                        ?{artwork,hours}:null;
                });
                if(parsed.some(x=>!x)||new Set(parsed.map(x=>x.artwork)).size!==parsed.length){
                    list=[];last=null;return;
                }
                list=parsed;
                last=list.length===1?list[0].artwork:null;
            } else if(['get_auction_state','get_artwork','get_artwork_provenance','open_artwork','prepare_bid'].includes(tool)){
                const confirmed=id(result.artwork_id);if(confirmed)last=confirmed;
            }
        }
        function snapshot(){touch();return {version:2,at:updated,last,auctions:list.slice(0,12)};}
        function restore(data){
            if(!data||data.version!==2||!Number.isFinite(data.at)||data.at>now()||now()-data.at>30000||
               (data.last!==null&&!id(data.last))||!Array.isArray(data.auctions)||data.auctions.length>12)return false;
            const auctions=[],seen=new Set();
            for(const a of data.auctions){
                const artwork=id(a?.artwork);
                if(!artwork||typeof a.hours!=='number'||!Number.isFinite(a.hours)||
                    a.hours<0||seen.has(artwork))return false;
                seen.add(artwork);auctions.push({artwork,hours:a.hours});
            }
            last=data.last;list=auctions;updated=now();return true;
        }
        function route(input,{lang='en',spoken=false,confidence=1}={}){
            const phrase=clean(input);if(!phrase)return null;touch();
            const ru=/[а-яё]/iu.test(phrase)||lang==='ru', t=phrase.toLowerCase().replace(/ё/g,'е').replace(/[?!.]+$/u,'');
            const say=(ruText,enText)=>({kind:'reply',text:ru?ruText:enText});
            const tool=(name,artwork)=>({kind:'tool',tool:name,input:artwork?{artwork_id:artwork}:{}});
            // Invalid or multiple explicit artwork IDs must not fall back to last.
            const mentions=[...t.matchAll(/(?:#|№|(?:работ[ауеы]*|произведени[ея]|artwork|work)\s*(?:номер|number|#)?\s*)(\d+)\b/giu)]
                .map(match=>match[1]);
            const distinct=[...new Set(mentions)];
            const named=distinct.length===1?id(distinct[0]):null;
            const selected=named||(mentions.length===0?last:null);
            if(distinct.length>1||(mentions.length>0&&!named))
                return say('Уточните один действительный номер работы. Ничего не запускаю.',
                    'Please specify one valid artwork number. No action was started.');
            if(/^(?:стоп|хватит|stop|end voice chat)$/iu.test(t))return {kind:'stop'};
            if(/(?:open nfg|open nf[gc]|okay storage room)/iu.test(t))
                return say('Похоже, фраза распознана неправильно. Уточните раздел или номер работы.','That may be misheard. Please name a section or artwork number.');
            if(/^(?:не |нет,?\s*не |не надо |don't |do not |never |no,?\s*not |отмена)/iu.test(t)&&
               /(?:откр|покаж|ставк|куп|прод|wallet|bid|buy|open|sell|аукцион|auction)/iu.test(t))
                return say('Ничего не открываю и не подтверждаю.','Nothing was opened or confirmed.');
            if(spoken&&Number(confidence)>0&&Number(confidence)<0.6&&
               /(?:bid|buy|sell|open|wallet|постав|купи|продай|открой|кошел)/iu.test(t))
                return say('Не уверена, что правильно расслышала. Исправьте текст перед отправкой.','Low recognition confidence. Correct the transcript before submitting.');
            if(/^(?:нет[, ]+|no[, ]+|actually[, ]+|не ту\b).*?(?:друг|other|wrong|different|не ту)/iu.test(t)){
                last=null;return say('Назовите номер другой работы, чтобы не выбирать случайную.','Please give the other artwork number so I do not guess.');
            }
            if(/(?:объясни|что (?:будет|произойдет)|расскажи|explain|what happens|how does).*?(?:после.*аукцион|аукцион.*заверш|расчет|settlement|after.*auction)/iu.test(t))return tool('explain_settlement');
            if(/(?:како[йе] (?:из них|аукцион).*?(?:раньше|перв|скорее)|котор[а-я]* заканчива|which (?:of them|one).*?(?:ends|finishes)|earliest (?:auction|deadline|end))/iu.test(t)){
                const sorted=list.slice().sort((a,b)=>a.hours-b.hours);
                if(sorted.length>1&&sorted[0].hours===sorted[1].hours)
                    return say('У двух аукционов одинаковый срок. Назовите номер работы.',
                        'Two auctions share the earliest deadline. Please specify an artwork number.');
                return sorted.length?tool('get_auction_state',sorted[0].artwork):say('Сначала получите текущий список аукционов.','First get a current list of open auctions.');
            }
            if(/^(?:покажи|какие|найди|что|есть ли|show|find|list|which|what|are there).*?(?:аукцион|auction)|^(?:что сейчас продается|what is up for auction)/iu.test(t))return tool('find_active_auctions');
            if(/^(?:расскажи подробнее|подробнее|расскажи об? этой работе|tell me more|tell me about this work|more details)/iu.test(t))
                return selected?tool('get_artwork',selected):say('Уточните номер работы.','Please specify the artwork number.');
            if(/(?:кто (?:сейчас )?(?:е[её] |ее |это )?(?:создал|автор|владелец)|кто сейчас владеет|кому (?:она|это) принадлежит|who (?:created|owns|made)|who is (?:the )?owner|provenance)/iu.test(t))
                return selected?tool('get_artwork_provenance',selected):say('Назовите номер работы, чтобы проверить владельца.','Please give the artwork number to check ownership.');
            if(/^(?:открой (?:ее|её|эту работу|страницу|ее страницу)|open (?:its|the|that|this) (?:page|artwork|work)|go to (?:its|that) page)$/iu.test(t))
                return selected?tool('open_artwork',selected):say('Назовите номер работы для открытия.','Please give the artwork number to open.');
            if(/(?:помоги|подготовь|хочу подготовить|help me|prepare|preview).*?(?:ставк|bid)/iu.test(t)){
                if(!/(?:ничего пока не|не подтвержд|без подписи|without (?:signing|confirming)|do not (?:confirm|sign)|preview|подготов|prepare)/iu.test(t))
                    return say('Могу только подготовить предварительный просмотр ставки.','I can only prepare a bid preview.');
                return selected?tool('prepare_bid',selected):say('Назовите номер работы. Подписывать ничего не нужно.','Please name the artwork. Nothing will be signed.');
            }
            if(/^(?:покажи (?:ставку|статус)|статус аукциона|what is the bid|auction status)/iu.test(t))
                return selected?tool('get_auction_state',selected):say('Нужен номер работы.','Which artwork number?');
            return null;
        }
        return Object.freeze({route,observe,clear,snapshot,restore});
    }
    window.ArtSoulVoiceConversation=Object.freeze({createDialogue});
})();