/* ArtSoul Voice R2: a bounded, read-only contextual intent layer.
 * It selects existing WebMCP tools. It neither signs nor grants wallet access. */
(function () {
    'use strict';
    const id = x => typeof x === 'string' && /^[1-9]\d{0,77}$/.test(x) && BigInt(x) < (1n<<256n) ? x : null;
    const clean = x => typeof x === 'string' ? x.trim().replace(/\s+/g,' ').slice(0,300) : '';
    function createDialogue(now=()=>Date.now()) {
        let last=null, list=[], searchResults=[], updated=now();
        const touch=()=>{if(now()<updated||now()-updated>900000)clear();updated=now();};
        function clear(){last=null;list=[];searchResults=[];updated=now();}
        function observe(tool,result){
            // Any new search replaces old search context; never invent search IDs.
            if(tool==='search_catalog'){
                searchResults=[];last=null;list=[];
                if(!result||typeof result!=='object'||Array.isArray(result)||result.error) return;
                const group=result.groups?.artworks;
                if(!group||!Array.isArray(group.items)) return;
                const parsed=group.items.slice(0,8).map(item=>{
                    const artwork=id(item?.artwork_id);
                    return artwork&&item?.url==='/artwork/'+artwork&&
                        typeof item?.title==='string'&&item.title.trim()
                        ?{artwork,title:item.title.trim()}:null;
                });
                if(parsed.some(x=>!x)||new Set(parsed.map(x=>x.artwork)).size!==parsed.length)return;
                searchResults=parsed;
                touch();return;
            }
            // A failed refresh must not let previous auction results drive a new choice.
            if(tool==='find_active_auctions'&&
               (!result||typeof result!=='object'||Array.isArray(result)||result.error||
                result.opened===false||result.prepared===false||result.submitted===false||
                result.updated===false||result.confirmed===false)){
                clear();return;
            }
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
            const ui=(action,extra={})=>({kind:'ui',action,...extra});
            // Invalid or multiple explicit artwork IDs must not fall back to last.
            const mentions=[...t.matchAll(/(?:#|№|(?:работ[ауеы]*|произведени[ея]|artwork|work)\s*(?:номер|number|#)?\s*)([+-]?\d[^\s,;!?]*)/giu)]
                .map(match=>match[1]);
            const distinct=[...new Set(mentions)];
            const named=distinct.length===1?id(distinct[0]):null;
            const selected=named||(mentions.length===0?last:null);
            if(distinct.length>1||(mentions.length>0&&!named))
                return say('Уточните один действительный номер работы. Ничего не запускаю.',
                    'Please specify one valid artwork number. No action was started.');
            if(/^(?:стоп|хватит|stop|end voice chat)$/iu.test(t))return {kind:'stop'};
            if(/(?:open nfg|open nf[gc]|okay storage room|^открой нфс$|^open nft open nft$)/iu.test(t))
                return say('Похоже, фраза распознана неправильно. Уточните раздел или номер работы.','That may be misheard. Please name a section or artwork number.');
            if(/^(?:не |нет,?\s*не |не надо |don't |do not |never |no,?\s*not |отмена)/iu.test(t)&&
               /(?:откр|покаж|ставк|куп|прод|wallet|bid|buy|open|sell|аукцион|auction)/iu.test(t))
                return say('Ничего не открываю и не подтверждаю.','Nothing was opened or confirmed.');
            if(spoken&&Number(confidence)>0&&Number(confidence)<0.6&&
               /(?:bid|buy|sell|open|show|nft|wallet|connect|notification|network|theme|future|classic|постав|купи|продай|открой|покаж|нфт|кошел|подключ|уведомлен|сеть|режим|тему)/iu.test(t))
                return say('Не уверена, что правильно расслышала. Исправьте текст перед отправкой.','Low recognition confidence. Correct the transcript before submitting.');

            // Exact examples witnessed in the 2026-11-21 browser recording.
            // These are bounded, RU/EN-equivalent intents, not a generative model.
            if(/^(?:hello|hi|hey|hello artsoul|привет|здравствуй(?:те)?|добрый день)[!,. ]*$/iu.test(t))
                return say('Привет! Что хотите посмотреть в ArtSoul?',
                    'Hello! What would you like to explore in ArtSoul?');
            if(/^(?:почему.*(?:на английском|по английски|по-английски)|why (?:are you|do you|is it).*(?:speak|speaking|english))/iu.test(t))
                return say('Русские команды поддерживаются. Для распознавания русской речи выберите RU. Не все фразы пока записаны голосом marin; остальные ответы доступны текстом.',
                    'Russian commands are supported. Select RU to recognize spoken Russian. Not every reply has a marin recording yet; other answers appear as text.');
            if(/^(?:это сделал[а]?|ты (?:это )?сделал[а]?|что ты сделал[а]?|did you do it|did you finish|what did you do)$/iu.test(t))
                return say('Уточните, какое действие нужно проверить. Я не выполняю операции с кошельком без вашего подтверждения.',
                    'Which action would you like me to check? I do not perform wallet operations without your approval.');
            if(/^(?:connect(?: to)?(?: my| the)? wallet|open(?: my| the)? wallet(?: menu)?|show(?: me)?(?: the)? wallet(?: menu)?|подключи(?:ть)?(?: мне)? (?:мой )?кошел(?:ек|ьк[ае])|открой(?: мне)? (?:мой )?кошел(?:ек|ьк[ае]))$/iu.test(t))
                return ui('walletMenu');
            if(/^(?:(?:show|open|check)(?: me)?(?: my| the)? )?notifications?$/iu.test(t)||
               /^(?:(?:покажи|открой|проверь)(?: мне)? )?уведомлени[еяий]+$/iu.test(t))
                return ui('notifications');
            if(/^(?:какая (?:сеть|сеть кошелька)(?: подключена)?|покажи какая сеть подключена|покажи (?:сеть|подключенную сеть|сеть кошелька)|к какой сети подключен кошелек|какая сеть сейчас|what network(?: is connected| am i on)?|which network(?: is connected| am i on)?|show (?:my |the )?(?:connected )?network|what chain am i on)$/iu.test(t))
                return ui('networkStatus');
            if(/^(?:режим|какой режим|тема|какая тема|mode|theme|appearance|change mode)$/iu.test(t))
                return say('Какой режим нужен: Classic или Future? Или вы хотите включить голосовой чат?',
                    'Which appearance do you want: Classic or Future? Or do you mean voice chat?');
            if(/^(?:включи|выбери|поставь|переключи(?:сь)? на) (?:режим |тему )?(?:future|будущ[а-я]+)$/iu.test(t)||
               /^(?:switch to|set|use) (?:the )?future (?:mode|theme|appearance)?$/iu.test(t))
                return ui('theme',{theme:'future'});
            if(/^(?:включи|выбери|поставь|переключи(?:сь)? на) (?:режим |тему )?(?:classic|классическ[а-я]+)$/iu.test(t)||
               /^(?:switch to|set|use) (?:the )?classic (?:mode|theme|appearance)?$/iu.test(t))
                return ui('theme',{theme:'classic'});

            // NFT intents are public navigation, not artwork title search.
            // Only canonical existing open_page enum destinations are permitted.
            const nftWords=t.replace(/(?:н[ -]?ф[ -]?т|эн[ -]?эф[ -]?ти|ен[ -]?эф[ -]?ти|n[ .-]?f[ .-]?t)(?![\p{L}\p{N}_])/gu,'nft');
            const nftTool=page=>({kind:'tool',tool:'open_page',input:{page}});
            const nftTerm='(?:nfts?)';
            if(new RegExp('^(?:(?:open|show(?: me)?|go to|browse|view|открой(?: мне)?|покажи(?: мне)?|перейди(?: в| на)?|хочу (?:открыть|посмотреть))\\s+)?(?:my|мои|мою)\\s+'+nftTerm+'$','iu').test(nftWords))
                return nftTool('collected');
            if(new RegExp('^(?:(?:open|show(?: me)?|go to|открой(?: мне)?|покажи(?: мне)?|перейди(?: в| на)?)\\s+)?'+nftTerm+'\\s+(?:in (?:my|the) wallet|from my wallet|в кошельке|из кошелька|моего кошелька)$','iu').test(nftWords))
                return nftTool('walletNfts');
            if(new RegExp('^(?:(?:open|show(?: me)?|go to|открой(?: мне)?|покажи(?: мне)?|перейди(?: в| на)?)\\s+)?'+nftTerm+'\\s+(?:in (?:my|the) profile|в профиле|моего профиля)$','iu').test(nftWords))
                return nftTool('collected');
            if(new RegExp('^(?:(?:open|show(?: me)?|go to|открой(?: мне)?|покажи(?: мне)?|перейди(?: в| на)?)\\s+)?'+nftTerm+'\\s+(?:marketplace|на маркетплейсе|в маркетплейсе)$','iu').test(nftWords))
                return nftTool('marketplace');
            if(new RegExp('^(?:(?:open|show(?: me)?|go to|browse|view|открой(?: мне)?|покажи(?: мне)?|перейди(?: в| на)?|хочу (?:открыть|посмотреть))\\s+)?(?:(?:all|the|все|весь|каталог|галерею|gallery|catalog|раздел|страницу)\\s+)?'+nftTerm+'(?:\\s+(?:gallery|catalog|галерею|каталог|в галерее|в каталоге))?$','iu').test(nftWords))
                return nftTool('nfts');
            // User spoke "open artworks"/"open Explorer"; both are gallery intents.
            if(/^(?:open|show|go to|take me to|browse) (?:the |my )?(?:artworks|works|explorer|art gallery)$/iu.test(t)||
               /^(?:открой|покажи|перейди в) (?:все )?(?:работы|произведения|эксплорер|эксплор|каталог работ)$/iu.test(t))
                return {kind:'tool',tool:'open_page',input:{page:'gallery'}};
            // A misheard NFT/NFC acronym must never be treated as a known artwork.
            if(/^(?:nft open nft|open nfc|open nfg|open nf[gc]|okay storage room)$/iu.test(t))
                return say('Похоже, распознавание перепутало NFT. Уточните: галерея, маркетплейс, коллекция или номер работы.',
                    'NFT may have been misheard. Choose gallery, marketplace, collection or an artwork number.');
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


            // Follow-up navigation may only use actual, validated search result IDs.
            // A named title is never guessed from a previous auction selection.
            const searchChoice=/^(?:open|show) (?:the )?(first|second|third|1st|2nd|3rd|\d+) (?:search )?(?:result|artwork|work)$/iu.exec(t)
                || /^(?:открой|покажи) (?:мне )?(первый|второй|третий|\d+)(?:-й)? (?:результат|работу из поиска)$/iu.exec(t);
            if(searchChoice){
                const ord=searchChoice[1].toLowerCase();
                const index=({first:0,second:1,third:2,'1st':0,'2nd':1,'3rd':2,
                    'первый':0,'второй':1,'третий':2})[ord]??(Number(ord)-1);
                if(!Number.isSafeInteger(index)||index<0||index>=searchResults.length)
                    return say('Такого номера нет в последних проверенных результатах. Повторите поиск.',
                        'That number is not in the latest verified search results. Search again.');
                return tool('open_artwork',searchResults[index].artwork);
            }
            if(/^(?:open (?:the |that )?(?:search )?result|открой (?:этот |найденный )?результат)$/iu.test(t)){
                return searchResults.length===1?tool('open_artwork',searchResults[0].artwork)
                    :say('Выберите номер результата: первый, второй или третий.',
                        'Choose a specific result: first, second, or third.');
            }
            // Voice "open <title>" is a public catalog search, never an
            // unverified direct navigation or wallet action. Actual result
            // links and artwork IDs must come from ArtSoul search_catalog.
            const requestByTitle = /^(?:open|show|find) (?:discovery |artwork (?:named |called |titled )?|work (?:named |called |titled )?)?(.{2,100})$/iu.exec(t)
                || /^(?:открой|покажи|найди)(?: мне)? (?:(?:работу|произведение|артворк)(?: с названием)? )?(.{2,100})$/iu.exec(t);
            if(requestByTitle){
                let title=requestByTitle[1].trim();
                if(/^discovery\s+/iu.test(title))title=title.replace(/^discovery\s+/iu,'');
                const reserved=/^(?:artworks|works|explorer|discovery|gallery|explore|profile|home|create|upload|nfts?|nfc|wallet|notification[s]?|theme|mode|аукионы|галерею|профиль|главную|кошелек|кошельк[ае]|уведомлени[еяий]+|режим|сеть)$/iu;
                const commandWord=/(?:\b(?:and|then|buy|bid|sell|withdraw|sign|approve|connect|http|www|admin|wallet|profile)\b|(?:\sи\s)|(?:купи|ставк|продай|подпиши|выведи|подключи|админ|кошел|http)|[;:{}<>])/iu;
                if(!reserved.test(title)&&!commandWord.test(title)&&!/^\d+(?:\.\d+)?$/u.test(title)&&
                    !/^(?:its?|the|that|this) (?:page|artwork|work)$/iu.test(title)&&
                    !/^(?:первый|второй|третий) результат$/iu.test(title)){
                    return {kind:'tool',tool:'search_catalog',input:{query:title,category:'artworks'}};
                }
            }
            return null;
        }
        return Object.freeze({route,observe,clear,snapshot,restore});
    }
    window.ArtSoulVoiceConversation=Object.freeze({createDialogue});
})();