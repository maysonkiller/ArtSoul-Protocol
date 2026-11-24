/* ArtSoul Protocol Solstice 2026/27. Preview-only visual layer. No chain, wallet or auction calls. */
(()=>{
  'use strict';
  if(window.__artsoulRealSeasonalPreview) return;
  window.__artsoulRealSeasonalPreview=true;
  const DOC=document, ROOT=DOC.documentElement, BODY=DOC.body;
  if(!BODY || !ROOT) return;
  const TARGET=Date.UTC(2026,11,31,23,0,0); // Jan 1 2027 00:00 Europe/Warsaw (CET)
  const reduceQuery=window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduce={get matches(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches},addEventListener:(...args)=>reduceQuery.addEventListener?.(...args)};
  const store={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
  const labels={
    en:{open:'Atmosphere',original:'Original',winter:'Winter',newyear:'New Year',snow:'Snowfall',on:'Snow on',off:'Snow off',close:'Close atmosphere settings',title:'Seasonal studio',test:'See New Year fireworks',note:'Visual atmosphere only. Wallets and auctions continue to work as usual.',ribbon:'WARSAW MIDNIGHT 2027',zone:'Europe/Warsaw / 01 Jan 2027',days:'DAYS',hours:'HRS',minutes:'MIN',seconds:'SEC',year:'A new chapter in art',scene:'Digital light becomes a celebration',sceneCap:'A COLLECTOR STORY CONTINUES',sceneSide:'UNTIL THE NEXT CHAPTER',happy:'Happy New Year 2027',preview:'New Year fireworks',paused:'Animations reduced by device settings',previewBadge:'ARTSOUL 2027',menu:'Choose appearance'},
    ru:{open:'Атмосфера',original:'Обычный',winter:'Зима',newyear:'Новый год',snow:'Снегопад',on:'Снег вкл',off:'Снег выкл',close:'Закрыть настройки атмосферы',title:'Праздничный режим',test:'Посмотреть новогодний салют',note:'Меняется только оформление. Кошелёк и аукционы работают как обычно.',ribbon:'ПОЛНОЧЬ В ВАРШАВЕ 2027',zone:'Europe/Warsaw / 1 января 2027',days:'ДНЕЙ',hours:'ЧАС',minutes:'МИН',seconds:'СЕК',year:'Новая глава искусства',scene:'Свет цифрового искусства становится праздником',sceneCap:'ИСТОРИЯ КОЛЛЕКЦИОНЕРОВ ПРОДОЛЖАЕТСЯ',sceneSide:'ДО НОВОЙ ГЛАВЫ',happy:'С Новым 2027 годом!',preview:'Новогодний салют',paused:'Анимация ограничена настройками устройства',previewBadge:'ARTSOUL 2027',menu:'Выбрать оформление'},
    pl:{open:'Atmosfera',original:'Oryginał',winter:'Zima',newyear:'Nowy Rok',snow:'Opady śniegu',on:'Śnieg włącz',off:'Śnieg wyłącz',close:'Zamknij ustawienia atmosfery',title:'Sezonowe studio',test:'Zobacz noworoczne fajerwerki',note:'Zmienia się tylko wygląd. Portfele i aukcje działają bez zmian.',ribbon:'PÓŁNOC W WARSZAWIE 2027',zone:'Europe/Warsaw / 1 stycznia 2027',days:'DNI',hours:'GODZ',minutes:'MIN',seconds:'SEK',year:'Nowy rozdział sztuki',scene:'Cyfrowe światło staje się świętem',sceneCap:'HISTORIA KOLEKCJONERÓW TRWA',sceneSide:'DO NOWEGO ROZDZIAŁU',happy:'Szczęśliwego Nowego Roku 2027!',preview:'Noworoczne fajerwerki',paused:'Animacje ograniczone przez ustawienia urządzenia',previewBadge:'ARTSOUL 2027',menu:'Wybierz motyw'}
  };
  const modes=['original','winter','newyear'];
  let mode=modes.includes(store.get('artsoul_seasonal_preview_mode'))?store.get('artsoul_seasonal_preview_mode'):'newyear';
  let snow=store.get('artsoul_seasonal_preview_snow')!=='off';
  let serverDelta=0,clockSynced=false,hasFired=false,lastDiff=Infinity;
  let locale='en';
  function language(){
    const langs=[ROOT.lang,BODY.lang,store.get('artsoul_language'),store.get('artsoul_lang'),navigator.language];
    for(const s of langs){const v=String(s||'').toLowerCase();if(v.startsWith('ru'))return 'ru';if(v.startsWith('pl'))return 'pl';if(v.startsWith('en'))return 'en';}
    return 'en';
  }
  const t=k=>labels[locale]?.[k]||labels.en[k]||k;
  const elt=(tag,attrs={})=>{const x=DOC.createElement(tag);for(const [k,v] of Object.entries(attrs))x.setAttribute(k,String(v));return x;};
  const ambient=elt('div',{id:'as-ambient','aria-hidden':'true'});BODY.appendChild(ambient);
  const weather=elt('canvas',{id:'as-weather','aria-hidden':'true'});BODY.appendChild(weather);
  const fire=elt('canvas',{id:'as-fireworks','aria-hidden':'true'});BODY.appendChild(fire);
  const toast=elt('div',{id:'as-midnight-toast',role:'status','aria-live':'polite'});BODY.appendChild(toast);
  const header=DOC.querySelector('header.site-header')||DOC.querySelector('header');
  const lights=elt('div',{id:'as-header-ornament','aria-hidden':'true'});
  const wire=elt('span',{class:'as-wire'});lights.appendChild(wire);
  const palette=['#ffd9a9','#f0b6b7','#cce9dd','#c5d9ff','#efd5a9'];
  for(let i=0;i<30;i++){const bulb=elt('span',{class:'as-bulb'});bulb.style.setProperty('--x',((i+.5)/30*100).toFixed(2)+'%');bulb.style.setProperty('--bulb',palette[(i*7)%palette.length]);bulb.style.setProperty('--delay',(-i*.21).toFixed(2)+'s');lights.appendChild(bulb)}
  if(header){if(getComputedStyle(header).position==='static')header.classList.add('as-living-header-position');header.appendChild(lights);}
  const ribbon=elt('div',{id:'as-countdown-ribbon',role:'timer','aria-label':'Countdown to New Year in Warsaw'});
  ribbon.innerHTML='<div class="as-ribbon-title"><b id="as-ribbon-heading"></b><span id="as-ribbon-zone"></span></div><div class="as-clock" id="as-clock"><strong id="as-days">00</strong><span id="as-days-label">DAYS</span><strong id="as-hours">00</strong><span>:</span><strong id="as-minutes">00</strong><span>:</span><strong id="as-seconds">00</strong></div><span class="as-ribbon-small" id="as-clock-label">Europe/Warsaw</span><span class="as-preview-badge" id="as-preview-badge">ARTSOUL 2027</span>';
  if(header)header.insertAdjacentElement('afterend',ribbon);else BODY.prepend(ribbon);
  const panelButton=elt('button',{id:'as-scene-button',type:'button','aria-expanded':'false','aria-haspopup':'dialog','aria-controls':'as-scene-panel'});
  panelButton.innerHTML='<span class="as-mode-indicator" aria-hidden="true"></span><span id="as-mode-label">Atmosphere</span><span aria-hidden="true">⌄</span>';
  BODY.appendChild(panelButton);
  const panel=elt('section',{id:'as-scene-panel',role:'dialog','aria-modal':'false','aria-label':'Seasonal studio','data-open':'false'});
  panel.innerHTML='<div class="as-panel-top"><h2 id="as-panel-title">Seasonal studio</h2><button class="as-panel-close" type="button" id="as-close">✕</button></div><div class="as-mode-grid" role="group" aria-label="Seasonal appearance"><button type="button" class="as-mode-option" data-mode="original">Original</button><button type="button" class="as-mode-option" data-mode="winter">Winter</button><button type="button" class="as-mode-option" data-mode="newyear">New Year</button></div><div class="as-panel-snow-row"><span id="as-snow-label">Snowfall</span><button class="as-snow-button" id="as-snow-toggle" type="button" aria-pressed="true">Snow on</button></div><button class="as-preview-button" id="as-preview-fireworks" type="button">See New Year fireworks</button><p class="as-panel-note" id="as-panel-note">Visual atmosphere only</p>';
  BODY.appendChild(panel);
  const scene=elt('section',{id:'as-solstice-scene','aria-label':'ArtSoul New Year light installation'});
  scene.innerHTML='<div class="as-scene-copy"><div class="as-scene-kicker" id="as-scene-cap"></div><h2 class="as-scene-title" id="as-scene-title"></h2><p class="as-scene-desc" id="as-scene-desc"></p></div><canvas id="as-tree-canvas" aria-hidden="true" width="255" height="226"></canvas><div class="as-scene-side" id="as-scene-side"></div>';
  const hero=DOC.querySelector('.home-hero');if(hero){hero.insertAdjacentElement('afterend',scene)}else{scene.classList.add('as-scene-internal');BODY.appendChild(scene)}
  const byId=id=>DOC.getElementById(id);
  const modeButtons=[...panel.querySelectorAll('[data-mode]')];
  let panelOpen=false,lastFocus=null;
  function closePanel(){panel.dataset.open='false';panelButton.setAttribute('aria-expanded','false');panelOpen=false;if(lastFocus&&typeof lastFocus.focus==='function')lastFocus.focus()}
  function openPanel(){lastFocus=DOC.activeElement;panel.dataset.open='true';panelButton.setAttribute('aria-expanded','true');panelOpen=true;modeButtons[0]?.focus()}
  panelButton.addEventListener('click',()=>panelOpen?closePanel():openPanel());
  byId('as-close').addEventListener('click',closePanel);
  DOC.addEventListener('pointerdown',e=>{if(panelOpen&&!panel.contains(e.target)&&!panelButton.contains(e.target))closePanel()});
  DOC.addEventListener('keydown',e=>{if(e.key==='Escape'&&panelOpen)closePanel()});
  modeButtons.forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;store.set('artsoul_seasonal_preview_mode',mode);applyMode()}));
  byId('as-snow-toggle').addEventListener('click',()=>{if(reduce.matches||mode==='original')return;snow=!snow;store.set('artsoul_seasonal_preview_snow',snow?'on':'off');applyMode()});
  byId('as-preview-fireworks').addEventListener('click',()=>showFireworks(false));
  function getHeaderOffset(){if(!header)return 0;const cs=getComputedStyle(header);return ['sticky','fixed'].includes(cs.position)?Math.round(header.getBoundingClientRect().height):0}
  function updateHeaderOffset(){ribbon.style.setProperty('--as-sticky-offset',getHeaderOffset()+'px')}
  function updateLabels(){locale=language();panel.setAttribute('aria-label',t('title'));panelButton.setAttribute('aria-label',t('menu'));byId('as-panel-title').textContent=t('title');byId('as-close').setAttribute('aria-label',t('close'));for(const b of modeButtons)b.textContent=t(b.dataset.mode);byId('as-snow-label').textContent=t('snow');byId('as-preview-fireworks').textContent=t('test');byId('as-panel-note').textContent=reduce.matches?t('paused'):t('note');byId('as-ribbon-heading').textContent=t('ribbon');byId('as-ribbon-zone').textContent=t('zone');byId('as-days-label').textContent=t('days');byId('as-preview-badge').textContent=t('previewBadge');byId('as-scene-title').textContent=t('year');byId('as-scene-desc').textContent=t('scene');byId('as-scene-cap').textContent=t('sceneCap');byId('as-scene-side').innerHTML='<span>'+t('sceneSide')+'</span><b>2027</b>';ribbon.setAttribute('aria-label',t('ribbon'));applyControlLabels()}
  function applyControlLabels(){byId('as-mode-label').textContent=t('open')+': '+t(mode);for(const b of modeButtons)b.setAttribute('aria-pressed',String(b.dataset.mode===mode));byId('as-snow-toggle').disabled=mode==='original'||reduce.matches;byId('as-snow-toggle').setAttribute('aria-pressed',String(snow&&mode!=='original'&&!reduce.matches));byId('as-snow-toggle').textContent=t(snow?'on':'off');byId('as-preview-fireworks').hidden=mode!=='newyear'}
  const wctx=weather.getContext('2d',{alpha:true});let flakes=[],weatherId=0,ww=0,wh=0,weatherLast=0;
  const rand=(a,b)=>a+Math.random()*(b-a);
  function resizeCanvas(canvas,ctx,maxDpr=1.6){let w=canvas===tree?Math.max(1,canvas.getBoundingClientRect().width):innerWidth,h=canvas===tree?Math.max(1,canvas.getBoundingClientRect().height):innerHeight;const d=Math.min(maxDpr,devicePixelRatio||1);canvas.width=Math.max(1,Math.round(w*d));canvas.height=Math.max(1,Math.round(h*d));if(ctx)ctx.setTransform(d,0,0,d,0,0);return {w,h}}
  function resizeWeather(){if(!wctx)return;({w:ww,h:wh}=resizeCanvas(weather,wctx));const n=Math.min(ww<600?46:92,Math.max(24,Math.round(ww*wh/15000)));flakes=Array.from({length:n},()=>({x:rand(0,ww),y:rand(0,wh),r:rand(.7,2.2),speed:rand(15,38),depth:rand(.45,1),phase:rand(0,6.28)}))}
  function stopWeather(){if(weatherId)cancelAnimationFrame(weatherId);weatherId=0;wctx?.clearRect(0,0,ww,wh)}
  function weatherFrame(now){
    weatherId=0;if(document.hidden||reduce.matches||!snow||mode==='original'||!wctx)return;
    const dt=Math.min(.045,Math.max(0,(now-weatherLast)/1000));weatherLast=now;wctx.clearRect(0,0,ww,wh);
    const cold=mode==='winter';
    for(let i=0;i<flakes.length;i++){
      const f=flakes[i];if(!cold&&i%3===0)continue;
      const depth=clamp(f.depth,.35,1.12),wind=cold?7:2.8;
      f.y+=f.speed*dt*(.6+depth*.62)*(cold?1.08:.74);
      f.x+=(wind+Math.sin(now*.00052+f.phase)*(cold?9:5))*dt;
      if(f.y>wh+6){f.y=-6;f.x=rand(0,ww);}if(f.x>ww+6)f.x=-6;if(f.x< -6)f.x=ww+6;
      wctx.fillStyle=cold?`rgba(232,247,255,${.20+.47*depth})`:`rgba(255,243,220,${.18+.36*depth})`;
      const radius=Math.min(2.6,f.r*(.62+depth*.31));
      wctx.beginPath();wctx.ellipse(f.x,f.y,radius,radius*(.87+(i%4)*.06),.2,0,Math.PI*2);wctx.fill();
    }
    weatherId=requestAnimationFrame(weatherFrame);
  }
  const tree=byId('as-tree-canvas');const tctx=tree?.getContext('2d',{alpha:true});let tw=0,th=0,treeId=0,treePoints=[];
  function stopTree(){if(treeId)cancelAnimationFrame(treeId);treeId=0;if(tctx)tctx.clearRect(0,0,tw,th)}
  function resizeTree(){if(!tctx)return;({w:tw,h:th}=resizeCanvas(tree,tctx,1.7));const n=tw<190?300:450;treePoints=Array.from({length:n},(_,i)=>({theta:i*2.39996*4.1,level:1-(i+.5)/n,spread:Math.pow((i+.5)/n,.75),size:rand(.65,1.8),pulse:rand(0,6.28),warm:i%6===0}))}
  function drawTree(now){treeId=0;if(mode!=='newyear'||!tctx)return;const time=now*.001,spin=reduce.matches?.26:time*.17,center=tw*.5,foot=th*.88,h=th*.75,radius=tw*.39;tctx.clearRect(0,0,tw,th);const g=tctx.createRadialGradient(center,foot-9,2,center,foot-9,tw*.5);g.addColorStop(0,'rgba(241,184,103,.3)');g.addColorStop(1,'rgba(241,184,103,0)');tctx.fillStyle=g;tctx.beginPath();tctx.ellipse(center,foot,tw*.47,18,0,0,Math.PI*2);tctx.fill();for(let band=0;band<2;band++){tctx.beginPath();for(let i=0;i<115;i++){const v=i/114,a=v*16.5+spin+band*2.9,rr=radius*Math.pow(v,.9);const x=center+Math.cos(a)*rr,y=foot-v*h+Math.sin(a)*rr*.12;if(i===0)tctx.moveTo(x,y);else tctx.lineTo(x,y)}tctx.strokeStyle=band?'rgba(132,241,200,.27)':'rgba(255,207,139,.40)';tctx.lineWidth=1;tctx.stroke()}for(const p of treePoints){const a=p.theta+spin,depth=Math.sin(a),rr=radius*p.spread,x=center+Math.cos(a)*rr,y=foot-p.level*h+depth*rr*.13,alpha=(.32+.44*Math.max(0,depth))*(reduce.matches?1:.8+.2*Math.sin(time*2.1+p.pulse));tctx.fillStyle=p.warm?`rgba(255,214,140,${alpha+.14})`:`rgba(150,235,207,${alpha})`;tctx.shadowColor=p.warm?'#fad88c':'#9de8d3';tctx.shadowBlur=p.warm?8:3;tctx.beginPath();tctx.arc(x,y,p.size*(1+depth*.15),0,Math.PI*2);tctx.fill()}tctx.shadowBlur=0;tctx.fillStyle='#f9e9af';tctx.shadowBlur=14;tctx.shadowColor='#f9dba0';tctx.beginPath();tctx.arc(center,foot-h-3,4.3,0,Math.PI*2);tctx.fill();tctx.shadowBlur=0;if(!reduce.matches&&!document.hidden)treeId=requestAnimationFrame(drawTree)}
  function updateMotion(){stopWeather();stopTree();if(mode==='newyear'&&tree&&hero){resizeTree();if(tctx)drawTree(performance.now())}if(!document.hidden&&!reduce.matches&&snow&&mode!=='original'&&wctx){weatherLast=performance.now();weatherId=requestAnimationFrame(weatherFrame)}}
  function applyMode(){BODY.dataset.asSeason=mode;ROOT.dataset.asSeason=mode;BODY.dataset.asSnow=snow?'on':'off';applyControlLabels();updateMotion();updateHeaderOffset();scheduleDecoration()}
  const fctx=fire.getContext('2d',{alpha:true});let fw=0,fh=0,particles=[],fireId=0,lastFrame=0,toastTimeout=0;
  const colors=['#f7deb0','#eac0a2','#9fe4df','#e75e85','#bcd2ff','#fff9e6'];
  function stopFire(){if(fireId)cancelAnimationFrame(fireId);fireId=0;particles=[];if(fctx)fctx.clearRect(0,0,fw,fh)}
  function burst(x,y,seed){for(let i=0;i<74;i++){const a=i*2.39996+seed,v=rand(40,205);particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:rand(.85,1.6),age:0,r:rand(.75,2.3),color:colors[(i+Math.floor(seed*4))%colors.length]})}}
  function fireFrame(now){fireId=0;if(document.hidden||!fctx){stopFire();return}const dt=Math.min(.055,Math.max(.001,(now-lastFrame)/1000));lastFrame=now;fctx.clearRect(0,0,fw,fh);for(const p of particles){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=54*dt;const alpha=Math.max(0,1-p.age/p.life);fctx.globalAlpha=alpha;fctx.fillStyle=p.color;fctx.beginPath();fctx.arc(p.x,p.y,p.r*Math.max(.4,alpha),0,Math.PI*2);fctx.fill()}fctx.globalAlpha=1;particles=particles.filter(p=>p.age<p.life);if(particles.length)fireId=requestAnimationFrame(fireFrame)}
  function showToast(msg){toast.textContent=msg;toast.dataset.visible='true';clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>{toast.dataset.visible='false'},4200)}
  function showFireworks(real){if(mode!=='newyear')return;showToast(t(real?'happy':'preview'));if(reduce.matches||!fctx)return;stopFire();({w:fw,h:fh}=resizeCanvas(fire,fctx));for(const [x,y,k] of [[.25,.29,0],[.74,.26,.8],[.45,.48,1.6],[.83,.49,2.1],[.15,.52,3]])burst(x*fw,y*fh,k);lastFrame=performance.now();fireId=requestAnimationFrame(fireFrame)}
  async function clockSync(){try{const a=Date.now();const response=await fetch('/robots.txt?as-clock='+Math.floor(a/60000),{method:'HEAD',cache:'no-store',signal:AbortSignal.timeout(2500)});const b=Date.now();const raw=response.headers.get('Date');if(raw){const x=Date.parse(raw),delta=x-(a+b)/2;if(Number.isFinite(delta)&&Math.abs(delta)<20000){serverDelta=delta;clockSynced=true}}}catch{}}
  let lastReduce=reduce.matches;
  function tick(){const nextReduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;if(nextReduce!==lastReduce){lastReduce=nextReduce;applyControlLabels();updateMotion()}const now=Date.now()+serverDelta,rem=Math.max(0,TARGET-now),days=Math.floor(rem/86400000),hrs=Math.floor(rem/3600000)%24,mins=Math.floor(rem/60000)%60,secs=Math.floor(rem/1000)%60,pad=n=>String(n).padStart(2,'0');byId('as-days').textContent=pad(days);byId('as-hours').textContent=pad(hrs);byId('as-minutes').textContent=pad(mins);byId('as-seconds').textContent=pad(secs);if(rem===0&&mode==='newyear'&&!hasFired&&!document.hidden&&now<TARGET+60000){hasFired=true;showFireworks(true)}lastDiff=rem;}
  window.addEventListener('resize',()=>{resizeWeather();updateMotion();updateHeaderOffset()},{passive:true});
  DOC.addEventListener('visibilitychange',()=>{if(DOC.hidden){stopWeather();stopTree();stopFire()}else{updateMotion();tick()}});
  reduce.addEventListener?.('change',()=>{applyControlLabels();updateMotion()});
  new MutationObserver(()=>{const next=language();if(next!==locale)updateLabels()}).observe(ROOT,{attributes:true,attributeFilter:['lang']});
  window.addEventListener('storage',ev=>{if(ev.key==='artsoul_language'||ev.key==='artsoul_lang')updateLabels()});
  /* ArtSoul Solstice v2: reversible snow details on every route.
     This touches only visual nodes, not business event handlers. */
  const scrollMist=elt('div',{id:'as-scroll-mist','aria-hidden':'true'});
  BODY.insertBefore(scrollMist,BODY.firstChild);
  /* Living Reality v8 — geometry-derived, contact-seated material. No state from
     wallet/payment logic is used. All offsets are CSS pixels measured at rest. */
  const surfaceRecords=new Map();
  const selectors=[
    '.site-header .logo-link','.site-primary-nav a','.site-header .mobile-nav a',
    '.site-header .site-header-actions button','.site-header .site-header-nav button',
    '.site-header .avatar-button','.site-header .menu-button','.site-header .mobile-menu-button',
    '.home-section-link','.publication-type-nav a','.launch-topline a',
    'main :is(a,button)', '.home-hero-actions a',
    ':is(.site-page-container,.gallery-page-main,.artwork-page-shell,.launch-page,.protocol-admin-root) :is(.home-showcase,.profile-card,.auction-card,.collection-card,.artwork-card,.artsoul-artwork-card,.nft-card,.artwork-tile,.artwork-detail-card,.gallery-card,.artwork-preview-card,.featured-artwork,.publish-panel,.home-highlight-card,.docs-card,.info-card,.feature-card,.collection-tile,.launch-hero,.launch-card,.admin-card,.metric-card,.dashboard-card,.artwork-page-panel,.auction-detail-panel,.profile-gallery-panel,.profile-collection-panel,.gallery-filter-panel)',
    '.gallery article','.gallery [data-artwork-card]','.gallery-page-main article'
  ];
  const targetSelector=selectors.join(',');
  const excluded='form,[role="dialog"],[role="menu"],[popover],dialog,.notification-panel,.upload-zone,.wallet-modal,.appkit-modal,.payment-modal,[data-checkout],[data-confirmation],.avatar-info,.avatar-dropdown-menu,.artsoul-wait,.artsoul-add-new-card,#as-scene-panel,#as-solstice-scene,#as-countdown-ribbon';
  const own='[data-as-living-decor],.as-santa-hat,.as-winter-crest,.as-page-halo';
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  function painted(value){
    if(!value||value==='transparent'||value==='none')return false;
    const m=value.match(/^rgba?\(([^)]+)\)/i);
    if(m){const parts=m[1].split(',');if(parts.length>=4)return Number(parts[3])>.12;}
    const modern=value.match(/\/\s*([\d.]+)(%)?\s*\)$/);if(modern)return Number(modern[1])/(modern[2]?100:1)>.12;
    return true;
  }
  function radiusPx(value,extent){const v=parseFloat(value)||0;return value.includes('%')?v*extent/100:v;}
  function surfaceType(el,st,r){
    if(!el.isConnected||el.closest(excluded)||el.closest('[hidden],[aria-hidden="true"]')||st.visibility!=='visible'||Number(st.opacity)<.05||r.width<18||r.height<12)return null;
    if(el.matches('.site-header .logo-link,.site-primary-nav a,.site-header .mobile-nav a,.publication-type-nav a,.home-section-link,.launch-topline a'))return 'ink';
    if(el.matches('.site-header .avatar-button'))return 'account';
    if(el.matches('a,button')&&(el.disabled||el.getAttribute('aria-disabled')==='true'))return null;
    const visibleBorder=(parseFloat(st.borderTopWidth)||0)>=.8&&st.borderTopStyle!=='none'&&st.borderTopStyle!=='hidden'&&painted(st.borderTopColor);
    const fill=painted(st.backgroundColor)||(st.backgroundImage!=='none'&&st.backgroundImage.includes('gradient('));
    if(!visibleBorder&&!fill)return null;
    if(el.matches('a,button')){
      if(r.width<27||r.height<26||r.height>112)return null;
      const rad=radiusPx(st.borderTopLeftRadius,r.width);
      return r.width<=90&&Math.abs(r.width-r.height)<r.width*.24&&rad>=r.width*.30?'round':'button';
    }
    if(r.width<112||r.height<64||r.width>Math.max(1800,innerWidth*1.1))return null;
    // Wide media frames with no paint are not a shelf; no decoration over NFT art.
    return 'card';
  }
  function signature(el,w,h){
    let v=2166136261;
    const key=(el.getAttribute('class')||'').replace(/\bas-living-[\w-]+/g,'')+'|'+(el.id||'')+'|'+(el.getAttribute('aria-label')||'')+'|'+Math.round(w)+'|'+Math.round(h);
    for(let i=0;i<key.length;i++)v=Math.imul(v^key.charCodeAt(i),16777619)>>>0;
    return v;
  }
  function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
  function smooth(points){
    if(!points.length)return '';
    const f=p=>p.map(v=>Number(v.toFixed(2))).join(' ');
    let d='M'+f(points[0]);
    for(let i=1;i<points.length-1;i++){const a=points[i],b=points[i+1];d+=' Q'+f(a)+' '+f([(a[0]+b[0])/2,(a[1]+b[1])/2]);}
    return d+' L'+f(points[points.length-1]);
  }
  function topGeometry(st,r,kind){
    const w=r.width,h=r.height;
    let left=st.borderTopLeftRadius.split(/\s+/),right=st.borderTopRightRadius.split(/\s+/);
    let lx=clamp(radiusPx(left[0],w),0,w/2),ly=clamp(radiusPx(left[1]||left[0],h),0,h/2);
    let rx=clamp(radiusPx(right[0],w),0,w/2),ry=clamp(radiusPx(right[1]||right[0],h),0,h/2);
    if(kind==='round'){lx=rx=w/2;ly=ry=h/2;}
    // Elliptic corner is the top visible material boundary; gravity follows +Y.
    const edge=x=>{
      if(lx>0&&x<lx){let d=clamp((x-lx)/lx,-1,1);return ly*(1-Math.sqrt(1-d*d));}
      if(rx>0&&x>w-rx){let d=clamp((x-(w-rx))/rx,-1,1);return ry*(1-Math.sqrt(1-d*d));}
      return 0;
    };
    return {w,h,edge,lx,ly,rx,ry};
  }
  let svgSerial=0;
  function bankMarkup(geo,kind,seed,festive,inside){
    const {w,h,edge,lx,rx}=geo,random=rng(seed+(festive?0x5981:0x177));
    const id='as-living-'+(++svgSerial),base=kind==='card'?clamp(w*.018,4.8,8.8):kind==='round'?clamp(w*.14,3.5,6):clamp(h*.12,3,5.3);
    const rise=festive?base*.54:base;
    // Each bank has an explicit contact seam (slight overlap into the edge),
    // tapering at both ends. Rounded controls have curved, never flat profiles.
    let a=kind==='round'?w*.16:Math.max(3,Math.min(w*.18,lx*.5+2));
    let b=kind==='round'?w*.84:w-Math.max(3,Math.min(w*.18,rx*.5+2));
    if(b-a<10)return '';
    const z=festive&&kind!=='round'?[[a,a+(b-a)*(.22+random()*.11)],[b-(b-a)*(.18+random()*.10),b]]:[[a,b]];
    const fmt=n=>Number(n.toFixed(2));
    const y0=18,shade=festive?'#b9b4ae':'#79a7c1';
    let paths='',grains='';
    for(const [lo,hi] of z){
      const samples=Math.max(5,Math.min(36,Math.ceil((hi-lo)/7)));
      let top=[],bottom=[],contact=[];
      for(let i=0;i<=samples;i++){
        const t=i/samples,x=lo+(hi-lo)*t,edgeY=edge(x)+y0,fade=Math.pow(Math.sin(Math.PI*t),.48),variation=.58+random()*.64;
        const thickness=rise*fade*variation;
        const seam=edgeY+(inside?1.4:0.75)+fade*1.05;
        // Clipped panels show snow INSIDE the frame instead of a hidden/floating cap.
        const upper=inside?edgeY+.22:edgeY-thickness;
        const lower=inside?edgeY+1+thickness*.80:seam;
        top.push([x,upper]);bottom.push([x,lower]);contact.push([x,seam]);
        if(i>0&&i<samples&&random()>.25){const gx=x+(random()-.5)*2,gy=upper+(lower-upper)*(.26+random()*.3);grains+='<circle cx="'+fmt(gx)+'" cy="'+fmt(gy)+'" r="'+fmt(.20+random()*.34)+'" fill="#fff" opacity="'+fmt(.25+random()*.36)+'"/>';}
      }
      const shape=smooth(top)+' L'+bottom.slice().reverse().map(p=>p.map(fmt).join(' ')).join(' L')+' Z';
      const shadow=smooth(bottom.map(([x,y])=>[x,y+.35]));
      paths+='<path d="'+shadow+'" fill="none" stroke="'+(festive?'#2a1619':'#0e2d43')+'" stroke-width="1.6" stroke-linecap="round" opacity=".64"/>'+
        '<path d="'+shape+'" fill="url(#'+id+')" stroke="'+shade+'" stroke-width=".26" stroke-linejoin="round"/>'+
        '<path d="'+smooth(top.map(([x,y])=>[x,y+.25]))+'" fill="none" stroke="#fff" stroke-width=".6" stroke-linecap="round" opacity=".8"/>';
      if(festive&&kind!=='round'){
        // One tiny twig tucked INTO the powder, grounded by the same seam.
        const x=lo+(hi-lo)*.61,y=edge(x)+y0+.65;
        paths+='<path d="M'+fmt(x-5)+' '+fmt(y+1)+' Q'+fmt(x)+' '+fmt(y-2)+' '+fmt(x+6)+' '+fmt(y+1)+'" fill="none" stroke="#35674d" stroke-width="1.1" stroke-linecap="round"/><path d="M'+fmt(x)+' '+fmt(y)+' l-2 -2.5 M'+fmt(x+2)+' '+fmt(y)+' l2 -2" stroke="#79a183" stroke-width=".65"/><circle cx="'+fmt(x+3)+'" cy="'+fmt(y+.2)+'" r="1.3" fill="#e8bd79"/>';
      }
    }
    const viewH=18+Math.min(h*.45,32)+5;
    return '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" viewBox="0 0 '+fmt(w)+' '+fmt(viewH)+'" width="'+fmt(w)+'" height="'+fmt(viewH)+'"><defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop stop-color="'+(festive?'#fffaf0':'#fbfeff')+'"/><stop offset=".43" stop-color="'+(festive?'#f2ede6':'#e4f3f9')+'"/><stop offset=".82" stop-color="'+(festive?'#d4d5d5':'#aecfdf')+'"/><stop offset="1" stop-color="'+shade+'"/></linearGradient></defs>'+paths+grains+'</svg>';
  }
  /* v8.1 — a separate renderer for circular tools. Geometry lives in a CSS
     background, so site rules targeting button SVG icons cannot shrink it.
     All visible material is inside the measured outer ellipse. */
  function roundMaterialMarkup(w,h,seed,holiday){
    const n=v=>Number(v.toFixed(3)),random=rng(seed+(holiday?0x40f:0x921));
    const rx=w/2,ry=h/2,min=Math.min(w,h),rim=clamp(min*.046,1.15,2.5);
    const xy=(deg,inset)=>{const a=deg*Math.PI/180;return [rx+(rx-inset)*Math.cos(a),ry+(ry-inset)*Math.sin(a)];};
    const pair=p=>p.map(n).join(' ');
    const arc=(a,b,inset)=>'M'+pair(xy(a,inset))+' A'+n(rx-inset)+' '+n(ry-inset)+' 0 '+(Math.abs(b-a)>180?1:0)+' '+(b>a?1:0)+' '+pair(xy(b,inset));
    const ell=(inset)=>' cx="'+n(rx)+'" cy="'+n(ry)+'" rx="'+n(rx-inset)+'" ry="'+n(ry-inset)+'"';
    let out='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+n(w)+' '+n(h)+'" preserveAspectRatio="none"><defs>';
    if(holiday){
      out+='<linearGradient id="metal" x1=".18" y1="0" x2=".78" y2="1"><stop stop-color="#fff0ba"/><stop offset=".17" stop-color="#c79452"/><stop offset=".36" stop-color="#6d412d"/><stop offset=".59" stop-color="#a66b3f"/><stop offset=".80" stop-color="#e8b46e"/><stop offset="1" stop-color="#805034"/></linearGradient></defs>';
      // Lacquered brass bezel and directional, warm reflections; deliberately
      // NO white powder arc or snow decal in the holiday circle material.
      out+='<ellipse'+ell(.70)+' fill="none" stroke="#3a1f19" stroke-width="1.4"/>'+
        '<ellipse'+ell(rim*.83)+' fill="none" stroke="url(#metal)" stroke-width="'+n(rim)+'"/>'+
        '<path d="'+arc(-142,-76,rim*1.23)+'" fill="none" stroke="#ffe4a5" stroke-opacity=".88" stroke-width=".82" stroke-linecap="round"/>'+
        '<path d="'+arc(36,113,rim*.85)+'" fill="none" stroke="#7c402b" stroke-width=".95" stroke-linecap="round"/>'+
        '<path d="'+arc(-58,-29,rim*1.40)+'" fill="none" stroke="#e59a63" stroke-opacity=".8" stroke-width=".7" stroke-linecap="round"/>';
    }else{
      out+='<linearGradient id="ice" x1=".25" y1="0" x2=".65" y2="1"><stop stop-color="#f6fdff"/><stop offset=".30" stop-color="#d7edf6"/><stop offset=".72" stop-color="#8ebbd2"/><stop offset="1" stop-color="#4c7c9c"/></linearGradient><linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#cceefa"/><stop offset=".48" stop-color="#55809a"/><stop offset="1" stop-color="#355268"/></linearGradient></defs>';
      out+='<ellipse'+ell(rim*.66)+' fill="none" stroke="url(#rim)" stroke-width="'+n(rim*.85)+'"/>';
      // Asymmetric settled frost: the lower seam overlaps the upper rim and
      // never separates from it. Thickness tapers as the slope gets steeper.
      const start=-153+random()*11,end=-29-random()*12,outer=[],inner=[],grains=[];
      const thickness=clamp(min*.11,2.55,5.2),samples=18;
      for(let i=0;i<=samples;i++){
        const t=i/samples,a=start+(end-start)*t,fade=Math.pow(Math.sin(Math.PI*t),.7),j=.77+random()*.43;
        outer.push(xy(a,.38));inner.push(xy(a,.55+thickness*fade*j));
        if(i>1&&i<samples-1&&random()>.30){const g=xy(a,.50+thickness*fade*(.20+random()*.40));grains.push('<circle cx="'+n(g[0])+'" cy="'+n(g[1])+'" r="'+n(.25+random()*.32)+'" fill="#fff" opacity=".78"/>');}
      }
      const seam=smooth(inner),shape=smooth(outer)+' L'+inner.slice().reverse().map(pair).join(' L')+' Z';
      out+='<path d="'+seam+'" fill="none" stroke="#102c3f" stroke-width="1.5" stroke-opacity=".82" stroke-linecap="round"/>'+
        '<path d="'+shape+'" fill="url(#ice)" stroke="#9bc4da" stroke-width=".30" stroke-linejoin="round"/>'+
        '<path d="'+smooth(outer.map(([x,y])=>[x,y+.36]))+'" fill="none" stroke="#fff" stroke-width=".62" stroke-linecap="round" opacity=".86"/>'+grains.join('');
      // A couple of tiny tapered melt ridges cling to the steep side rather
      // than hanging across the readable center of the icon.
      const a=end-5,p=xy(a,1.0),q=xy(a,2.9),len=clamp(min*.065,1.4,3.4);
      out+='<path d="M'+pair(p)+' Q'+n(p[0]+.15)+' '+n(p[1]+len*.6)+' '+n(p[0]-.8)+' '+n(p[1]+len)+' Q'+n(q[0]-.5)+' '+n(q[1]+len*.2)+' '+pair(q)+' Z" fill="#bbdfef" opacity=".85"/>';
    }
    return out+'</svg>';
  }
  let accountHost=null,accountButton=null,accountSizeObserver=null;
  function removeAccount(){if(accountHost){accountHost.querySelectorAll(':scope > [data-as-living-account]').forEach(x=>x.remove());accountHost.classList.remove('as-living-account-host','as-living-account-position');}accountSizeObserver?.disconnect();accountHost=null;accountButton=null;}
  function accountMarkup(holiday,id){
    if(holiday)return '<svg viewBox="0 0 100 86" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs><linearGradient id="'+id+'-felt" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="#f56a66"/><stop offset=".32" stop-color="#b91c31"/><stop offset=".7" stop-color="#921126"/><stop offset="1" stop-color="#560b23"/></linearGradient><linearGradient id="'+id+'-fur" x1="0" y1="0" x2=".15" y2="1"><stop stop-color="#fffef9"/><stop offset=".48" stop-color="#f1f1ed"/><stop offset="1" stop-color="#b6c8d4"/></linearGradient><radialGradient id="'+id+'-pom" cx=".25" cy=".2" r=".8"><stop stop-color="#fff"/><stop offset=".55" stop-color="#f7f4ed"/><stop offset="1" stop-color="#bccbd4"/></radialGradient></defs><path d="M19 72 C24 53 35 26 48 14 C59 5 73 4 80 15 C87 25 79 40 88 49 L80 60 C65 52 57 40 57 30 C42 44 39 58 37 67 Z" fill="url(#'+id+'-felt)" stroke="#761327" stroke-width=".8"/><path d="M57 30 C60 18 68 13 76 16 C83 27 75 42 86 49 L80 55 C68 49 58 38 57 30" fill="#6b0c22" opacity=".74"/><path d="M27 65 C34 43 44 23 57 16" fill="none" stroke="#ffb3a0" stroke-width="2.8" opacity=".44" stroke-linecap="round"/><path d="M20 70 Q35 58 50 59 Q65 58 78 69 Q84 73 82 80 Q81 84 76 84 Q65 74 50 73 Q36 73 23 84 Q16 86 15 78 Q14 74 20 70Z" fill="url(#'+id+'-fur)" stroke="#b4c1c7" stroke-width=".7"/><path d="M19 72 Q33 63 49 62 Q66 62 78 72" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M22 82 Q35 72 50 72 Q65 72 77 82" fill="none" stroke="#8ca5b1" stroke-width="1.2" opacity=".7"/><path d="M82 45 Q87 40 91 44 Q97 45 96 51 Q100 56 94 60 Q94 66 87 64 Q82 67 78 62 Q71 60 75 53 Q74 48 82 45Z" fill="url(#'+id+'-pom)" stroke="#bcc7cf" stroke-width=".65"/><path d="M79 50 Q85 44 91 47" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><g fill="#fff" opacity=".6"><circle cx="29" cy="73" r=".8"/><circle cx="38" cy="68" r=".7"/><circle cx="54" cy="67" r=".75"/><circle cx="66" cy="72" r=".7"/><circle cx="87" cy="54" r=".8"/></g></svg>';
    // Frost follows the upper arc; the short icicles hang vertically FROM it.
    return '<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs><linearGradient id="'+id+'-ice" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff"/><stop offset=".42" stop-color="#d6f4ff"/><stop offset=".77" stop-color="#8cc9e4"/><stop offset="1" stop-color="#327aa7" stop-opacity=".4"/></linearGradient></defs><path d="M16 30 Q23 21 30 17 Q35 10 43 12 Q48 7 55 10 Q63 9 70 15 Q79 19 84 30 L81 32 Q72 22 64 19 Q54 17 50 17 Q41 17 31 22 Q23 26 18 32Z" fill="url(#'+id+'-ice)" stroke="#d7f4ff" stroke-width=".7"/><path d="M24 25 L24 35 Q25 39 27 36 L30 22 M69 21 L72 39 Q73 43 75 38 L76 26 M80 29 L83 40 L84 31" fill="url(#'+id+'-ice)" stroke="#a6d9ee" stroke-width=".6"/><path d="M27 20 Q39 12 48 12 M54 12 Q66 13 74 20 M72 25 L73 35" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".84" fill="none"/></svg>';
  }
  function syncAccount(){
    const el=[...DOC.querySelectorAll('.site-header .avatar-button')].find(n=>{const b=n.getBoundingClientRect();return b.width>=20&&b.height>=20&&!n.closest('[hidden],[aria-hidden="true"]');});
    if(mode==='original'||!el||!el.isConnected||el.closest('[hidden]')){removeAccount();return;}
    const host=el.closest('.avatar-plaque')||el.parentElement;if(!host)return;
    if(host!==accountHost||el!==accountButton){removeAccount();accountHost=host;accountButton=el;host.classList.add('as-living-account-host');if(getComputedStyle(host).position==='static')host.classList.add('as-living-account-position');if(typeof ResizeObserver==='function'){accountSizeObserver=new ResizeObserver(scheduleDecoration);accountSizeObserver.observe(host);accountSizeObserver.observe(el);}}
    const r=el.getBoundingClientRect(),p=host.getBoundingClientRect();if(r.width<20||r.height<20){host.querySelectorAll(':scope > [data-as-living-account]').forEach(n=>n.remove());return;}
    const holiday=mode==='newyear',cls=holiday?'as-santa-hat':'as-winter-crest';
    let ornament=host.querySelector(':scope > [data-as-living-account]');
    if(!ornament||!ornament.classList.contains(cls)){
      ornament?.remove();ornament=elt('span',{'class':cls+' as-living-account','data-as-living-account':'true','data-as-living-decor':'true','aria-hidden':'true'});ornament.innerHTML=accountMarkup(holiday,'as-wearable-'+(++svgSerial));host.appendChild(ornament);
    }
    const centerX=r.left+r.width/2;
    const width=Math.min(clamp(r.width*(holiday?1.28:1.15),36,76),Math.max(r.width,2*Math.min(centerX-2,innerWidth-centerX-2))),height=width*(holiday?.86:.50);
    // The brim's centre y=73 or ice crest y=17 is seated on the circle tangent.
    const x=r.left+r.width/2-p.left-(parseFloat(getComputedStyle(host).borderLeftWidth)||0),y=r.top-p.top-(parseFloat(getComputedStyle(host).borderTopWidth)||0)-height*(holiday?.82:.34)+1.5;
    ornament.style.setProperty('--as-wear-x',x.toFixed(2)+'px');ornament.style.setProperty('--as-wear-y',y.toFixed(2)+'px');ornament.style.setProperty('--as-wear-w',width.toFixed(2)+'px');ornament.style.setProperty('--as-wear-h',height.toFixed(2)+'px');
  }
  const sizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(()=>scheduleDecoration()):null;
  function cleanup(el,rec){rec?.node?.remove();el.classList.remove('as-living-surface','as-living-position','as-living-ink','as-living-round-control');sizeObserver?.unobserve(el);surfaceRecords.delete(el);}
  function decorateNode(el){
    if(el.matches('.site-header .avatar-button'))return;
    const st=getComputedStyle(el),r=el.getBoundingClientRect(),kind=surfaceType(el,st,r),old=surfaceRecords.get(el);
    if(!kind||kind==='account'||mode==='original'){if(old)cleanup(el,old);return;}
    if(kind==='ink'){
      if(old?.kind==='ink')return;if(old)cleanup(el,old);el.classList.add('as-living-ink');surfaceRecords.set(el,{kind});return;
    }
    const key=[kind,mode,Math.round(r.width*2)/2,Math.round(r.height*2)/2,st.borderTopLeftRadius,st.borderTopRightRadius,st.overflowX,st.overflowY].join('|');
    if(old?.key===key&&old.node?.parentNode===el)return;
    if(old)cleanup(el,old);if(surfaceRecords.size>=180)return;
    const clipped=[st.overflowX,st.overflowY].some(s=>s==='hidden'||s==='clip'||s==='auto'||s==='scroll');
    const round=kind==='round',seed=signature(el,r.width,r.height);
    const markup=round?roundMaterialMarkup(r.width,r.height,seed,mode==='newyear'):bankMarkup(topGeometry(st,r,kind),kind,seed,mode==='newyear',clipped);if(!markup)return;
    el.classList.add('as-living-surface');if(round)el.classList.add('as-living-round-control');if(getComputedStyle(el).position==='static')el.classList.add('as-living-position');
    const node=elt('span',{'class':'as-living-bank as-living-'+kind+(round?' as-living-ring':''),'data-as-living-decor':'true','aria-hidden':'true'});node.style.setProperty('--as-bank-x',(-(parseFloat(st.borderLeftWidth)||0))+'px');node.style.setProperty('--as-bank-y',((round?0:-18)-(parseFloat(st.borderTopWidth)||0))+'px');
    if(round){
      node.style.setProperty('--as-ring-w',r.width+'px');node.style.setProperty('--as-ring-h',r.height+'px');
      node.dataset.asRingMaterial=mode==='newyear'?'brass':'ice';
      node.style.backgroundImage='url("data:image/svg+xml,'+encodeURIComponent(markup)+'")';
    }else node.innerHTML=markup;
    el.appendChild(node);surfaceRecords.set(el,{kind,key,node});sizeObserver?.observe(el);
  }
  function decorateSite(){
    if(document.hidden)return;
    updateHeaderOffset();
    for(const [el,rec] of surfaceRecords){if(mode==='original'||!el.isConnected||!el.matches(targetSelector))cleanup(el,rec);}
    syncAccount();if(mode==='original')return;
    for(const el of DOC.querySelectorAll(targetSelector))decorateNode(el);
  }
  let decorTimer=0;
  function scheduleDecoration(){if(decorTimer)return;decorTimer=setTimeout(()=>{decorTimer=0;decorateSite();},100);}
  window.addEventListener('resize',scheduleDecoration,{passive:true});
  const livingHeaderObserver=typeof ResizeObserver==='function'&&header?new ResizeObserver(()=>{updateHeaderOffset();scheduleDecoration();}):null;
  livingHeaderObserver?.observe(header);
  const domObserver=new MutationObserver(records=>{
    if(records.some(record=>{
      const t=record.target;if(t.nodeType===1&&t.closest?.(own))return false;
      if(record.type==='attributes')return !t.closest?.('#as-scene-panel,#as-countdown-ribbon,#as-solstice-scene')&&(record.attributeName!=='class'||String(record.oldValue||'').replace(/\bas-living-[\w-]+/g,'').trim()!==String(t.className||'').replace(/\bas-living-[\w-]+/g,'').trim());
      return [...record.addedNodes,...record.removedNodes].some(n=>n.nodeType===1&&!n.matches?.(own))||[...record.removedNodes].some(n=>n.nodeType===1&&n.matches?.('[data-as-living-decor]')&&(surfaceRecords.get(t)?.node===n||t===accountHost&&n.hasAttribute('data-as-living-account')));
    }))scheduleDecoration();
  });
  domObserver.observe(BODY,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','aria-hidden','aria-disabled'],attributeOldValue:true});
  DOC.addEventListener('visibilitychange',()=>{if(!DOC.hidden)scheduleDecoration();});
  /* Additional near/far snow depth, respecting device capacity. */
  const originalResizeWeather=resizeWeather;
  resizeWeather=function(){
    originalResizeWeather();
    const density=ww<620?Math.min(78,Math.max(42,Math.round(ww*wh/7900))):Math.min(148,Math.max(65,Math.round(ww*wh/9200)));
    flakes=Array.from({length:density},(_,i)=>({
      x:rand(0,ww),y:rand(-30,wh),r:rand(.65,i%10===0?3.2:2.35),
      speed:rand(i%5===0?18:11,i%5===0?54:39),
      depth:rand(.44,1.1),phase:rand(0,6.28)
    }));
  };
  resizeWeather();updateLabels();applyMode();tick();setInterval(tick,1000);clockSync().then(tick);
  window.ArtSoulSeasonalPreview={getState:()=>({mode,snow,locale,timezone:'Europe/Warsaw',targetUtc:new Date(TARGET).toISOString(),clockSynced}),previewFireworks:()=>showFireworks(false),setMode:x=>{if(modes.includes(x)){mode=x;applyMode()}}};
})();
