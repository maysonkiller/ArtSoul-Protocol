/* ArtSoul Protocol Solstice 2026/27. Preview-only visual layer. No chain, wallet or auction calls. */
(()=>{
  'use strict';
  if(window.__artsoulRealSeasonalPreview) return;
  window.__artsoulRealSeasonalPreview=true;
  const DOC=document, ROOT=DOC.documentElement, BODY=DOC.body;
  if(!BODY || !ROOT) return;
  const TARGET=Date.UTC(2026,11,31,23,0,0); // Jan 1 2027 00:00 Europe/Warsaw (CET)
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  const store={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
  const labels={
    en:{open:'Atmosphere',original:'Original',winter:'Winter',newyear:'New Year',snow:'Snowfall',on:'Snow on',off:'Snow off',close:'Close atmosphere settings',title:'Seasonal studio',test:'Preview midnight fireworks',note:'Preview appearance only. Live auctions and wallet actions are unchanged.',ribbon:'WARSAW MIDNIGHT 2027',zone:'Europe/Warsaw · 01 Jan 2027',days:'DAYS',hours:'HRS',minutes:'MIN',seconds:'SEC',year:'A new chapter in art',scene:'Digital light becomes a celebration',sceneCap:'A COLLECTOR STORY CONTINUES',sceneSide:'UNTIL THE NEXT CHAPTER',happy:'Happy New Year 2027',preview:'Midnight preview',paused:'Animations reduced by device settings',previewBadge:'PREVIEW',menu:'Choose appearance'},
    ru:{open:'Атмосфера',original:'Обычный',winter:'Зима',newyear:'Новый год',snow:'Снегопад',on:'Снег вкл',off:'Снег выкл',close:'Закрыть настройки атмосферы',title:'Праздничный режим',test:'Проверить новогодний салют',note:'Только оформление для просмотра. Кошелёк и аукционы не изменены.',ribbon:'ПОЛНОЧЬ В ВАРШАВЕ 2027',zone:'Europe/Warsaw · 1 января 2027',days:'ДНЕЙ',hours:'ЧАС',minutes:'МИН',seconds:'СЕК',year:'Новая глава искусства',scene:'Свет цифрового искусства становится праздником',sceneCap:'ИСТОРИЯ КОЛЛЕКЦИОНЕРОВ ПРОДОЛЖАЕТСЯ',sceneSide:'ДО НОВОЙ ГЛАВЫ',happy:'С Новым 2027 годом!',preview:'Предпросмотр полуночи',paused:'Анимация ограничена настройками устройства',previewBadge:'ПРЕВЬЮ',menu:'Выбрать оформление'},
    pl:{open:'Atmosfera',original:'Oryginał',winter:'Zima',newyear:'Nowy Rok',snow:'Opady śniegu',on:'Śnieg włącz',off:'Śnieg wyłącz',close:'Zamknij ustawienia atmosfery',title:'Sezonowe studio',test:'Podgląd fajerwerków',note:'Tylko wygląd demonstracyjny. Portfele i aukcje bez zmian.',ribbon:'PÓŁNOC W WARSZAWIE 2027',zone:'Europe/Warsaw · 1 stycznia 2027',days:'DNI',hours:'GODZ',minutes:'MIN',seconds:'SEK',year:'Nowy rozdział sztuki',scene:'Cyfrowe światło staje się świętem',sceneCap:'HISTORIA KOLEKCJONERÓW TRWA',sceneSide:'DO NOWEGO ROZDZIAŁU',happy:'Szczęśliwego Nowego Roku 2027!',preview:'Podgląd północy',paused:'Animacje ograniczone przez ustawienia urządzenia',previewBadge:'PODGLĄD',menu:'Wybierz motyw'}
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
  if(header)header.appendChild(lights);
  const ribbon=elt('div',{id:'as-countdown-ribbon',role:'timer','aria-label':'Countdown to New Year in Warsaw'});
  ribbon.innerHTML='<div class="as-ribbon-title"><b id="as-ribbon-heading"></b><span id="as-ribbon-zone"></span></div><div class="as-clock" id="as-clock"><strong id="as-days">00</strong><span id="as-days-label">DAYS</span><strong id="as-hours">00</strong><span>:</span><strong id="as-minutes">00</strong><span>:</span><strong id="as-seconds">00</strong></div><span class="as-ribbon-small" id="as-clock-label">Europe/Warsaw</span><span class="as-preview-badge" id="as-preview-badge">PREVIEW</span>';
  if(header)header.insertAdjacentElement('afterend',ribbon);else BODY.prepend(ribbon);
  const panelButton=elt('button',{id:'as-scene-button',type:'button','aria-expanded':'false','aria-haspopup':'dialog','aria-controls':'as-scene-panel'});
  panelButton.innerHTML='<span class="as-mode-indicator" aria-hidden="true"></span><span id="as-mode-label">Atmosphere</span><span aria-hidden="true">⌄</span>';
  BODY.appendChild(panelButton);
  const panel=elt('section',{id:'as-scene-panel',role:'dialog','aria-modal':'false','aria-label':'Seasonal studio','data-open':'false'});
  panel.innerHTML='<div class="as-panel-top"><h2 id="as-panel-title">Seasonal studio</h2><button class="as-panel-close" type="button" id="as-close">✕</button></div><div class="as-mode-grid" role="group" aria-label="Seasonal appearance"><button type="button" class="as-mode-option" data-mode="original">Original</button><button type="button" class="as-mode-option" data-mode="winter">Winter</button><button type="button" class="as-mode-option" data-mode="newyear">New Year</button></div><div class="as-panel-snow-row"><span id="as-snow-label">Snowfall</span><button class="as-snow-button" id="as-snow-toggle" type="button" aria-pressed="true">Snow on</button></div><button class="as-preview-button" id="as-preview-fireworks" type="button">Preview midnight fireworks</button><p class="as-panel-note" id="as-panel-note">Appearance preview only</p>';
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
  function applyControlLabels(){byId('as-mode-label').textContent=t('open')+' · '+t(mode);for(const b of modeButtons)b.setAttribute('aria-pressed',String(b.dataset.mode===mode));byId('as-snow-toggle').disabled=mode==='original'||reduce.matches;byId('as-snow-toggle').setAttribute('aria-pressed',String(snow&&mode!=='original'&&!reduce.matches));byId('as-snow-toggle').textContent=t(snow?'on':'off');byId('as-preview-fireworks').hidden=mode!=='newyear'}
  const wctx=weather.getContext('2d',{alpha:true});let flakes=[],weatherId=0,ww=0,wh=0,weatherLast=0;
  const rand=(a,b)=>a+Math.random()*(b-a);
  function resizeCanvas(canvas,ctx,maxDpr=1.6){let w=canvas===tree?Math.max(1,canvas.getBoundingClientRect().width):innerWidth,h=canvas===tree?Math.max(1,canvas.getBoundingClientRect().height):innerHeight;const d=Math.min(maxDpr,devicePixelRatio||1);canvas.width=Math.max(1,Math.round(w*d));canvas.height=Math.max(1,Math.round(h*d));if(ctx)ctx.setTransform(d,0,0,d,0,0);return {w,h}}
  function resizeWeather(){if(!wctx)return;({w:ww,h:wh}=resizeCanvas(weather,wctx));const n=Math.min(ww<600?46:92,Math.max(24,Math.round(ww*wh/15000)));flakes=Array.from({length:n},()=>({x:rand(0,ww),y:rand(0,wh),r:rand(.7,2.2),speed:rand(15,38),depth:rand(.45,1),phase:rand(0,6.28)}))}
  function stopWeather(){if(weatherId)cancelAnimationFrame(weatherId);weatherId=0;wctx?.clearRect(0,0,ww,wh)}
  function weatherFrame(now){weatherId=0;if(document.hidden||reduce.matches||!snow||mode==='original'||!wctx)return;const dt=Math.min(.045,Math.max(0,(now-weatherLast)/1000));weatherLast=now;wctx.clearRect(0,0,ww,wh);for(const f of flakes){f.y+=f.speed*dt*f.depth;f.x+=(Math.sin(now*.0004+f.phase)*7+2)*dt;if(f.y>wh+5){f.y=-5;f.x=rand(0,ww)}if(f.x>ww+5)f.x=-5;wctx.beginPath();wctx.arc(f.x,f.y,f.r,0,Math.PI*2);wctx.fillStyle=mode==='newyear'?`rgba(243,233,223,${.26+.39*f.depth})`:`rgba(226,247,255,${.30+.44*f.depth})`;wctx.fill()}weatherId=requestAnimationFrame(weatherFrame)}
  const tree=byId('as-tree-canvas');const tctx=tree?.getContext('2d',{alpha:true});let tw=0,th=0,treeId=0,treePoints=[];
  function stopTree(){if(treeId)cancelAnimationFrame(treeId);treeId=0;if(tctx)tctx.clearRect(0,0,tw,th)}
  function resizeTree(){if(!tctx)return;({w:tw,h:th}=resizeCanvas(tree,tctx,1.7));const n=tw<190?300:450;treePoints=Array.from({length:n},(_,i)=>({theta:i*2.39996*4.1,level:1-(i+.5)/n,spread:Math.pow((i+.5)/n,.75),size:rand(.65,1.8),pulse:rand(0,6.28),warm:i%6===0}))}
  function drawTree(now){treeId=0;if(mode!=='newyear'||!tctx)return;const time=now*.001,spin=reduce.matches?.26:time*.17,center=tw*.5,foot=th*.88,h=th*.75,radius=tw*.39;tctx.clearRect(0,0,tw,th);const g=tctx.createRadialGradient(center,foot-9,2,center,foot-9,tw*.5);g.addColorStop(0,'rgba(241,184,103,.3)');g.addColorStop(1,'rgba(241,184,103,0)');tctx.fillStyle=g;tctx.beginPath();tctx.ellipse(center,foot,tw*.47,18,0,0,Math.PI*2);tctx.fill();for(let band=0;band<2;band++){tctx.beginPath();for(let i=0;i<115;i++){const v=i/114,a=v*16.5+spin+band*2.9,rr=radius*Math.pow(v,.9);const x=center+Math.cos(a)*rr,y=foot-v*h+Math.sin(a)*rr*.12;if(i===0)tctx.moveTo(x,y);else tctx.lineTo(x,y)}tctx.strokeStyle=band?'rgba(132,241,200,.27)':'rgba(255,207,139,.40)';tctx.lineWidth=1;tctx.stroke()}for(const p of treePoints){const a=p.theta+spin,depth=Math.sin(a),rr=radius*p.spread,x=center+Math.cos(a)*rr,y=foot-p.level*h+depth*rr*.13,alpha=(.32+.44*Math.max(0,depth))*(reduce.matches?1:.8+.2*Math.sin(time*2.1+p.pulse));tctx.fillStyle=p.warm?`rgba(255,214,140,${alpha+.14})`:`rgba(150,235,207,${alpha})`;tctx.shadowColor=p.warm?'#fad88c':'#9de8d3';tctx.shadowBlur=p.warm?8:3;tctx.beginPath();tctx.arc(x,y,p.size*(1+depth*.15),0,Math.PI*2);tctx.fill()}tctx.shadowBlur=0;tctx.fillStyle='#f9e9af';tctx.shadowBlur=14;tctx.shadowColor='#f9dba0';tctx.beginPath();tctx.arc(center,foot-h-3,4.3,0,Math.PI*2);tctx.fill();tctx.shadowBlur=0;if(!reduce.matches&&!document.hidden)treeId=requestAnimationFrame(drawTree)}
  function updateMotion(){stopWeather();stopTree();if(mode==='newyear'&&tree&&hero){resizeTree();if(tctx)drawTree(performance.now())}if(!document.hidden&&!reduce.matches&&snow&&mode!=='original'&&wctx){weatherLast=performance.now();weatherId=requestAnimationFrame(weatherFrame)}}
  function applyMode(){BODY.dataset.asSeason=mode;ROOT.dataset.asSeason=mode;BODY.dataset.asSnow=snow?'on':'off';applyControlLabels();updateMotion();updateHeaderOffset()}
  const fctx=fire.getContext('2d',{alpha:true});let fw=0,fh=0,particles=[],fireId=0,lastFrame=0,toastTimeout=0;
  const colors=['#f7deb0','#eac0a2','#9fe4df','#e75e85','#bcd2ff','#fff9e6'];
  function stopFire(){if(fireId)cancelAnimationFrame(fireId);fireId=0;particles=[];if(fctx)fctx.clearRect(0,0,fw,fh)}
  function burst(x,y,seed){for(let i=0;i<74;i++){const a=i*2.39996+seed,v=rand(40,205);particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:rand(.85,1.6),age:0,r:rand(.75,2.3),color:colors[(i+Math.floor(seed*4))%colors.length]})}}
  function fireFrame(now){fireId=0;if(document.hidden||!fctx){stopFire();return}const dt=Math.min(.055,Math.max(.001,(now-lastFrame)/1000));lastFrame=now;fctx.clearRect(0,0,fw,fh);for(const p of particles){p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=54*dt;const alpha=Math.max(0,1-p.age/p.life);fctx.globalAlpha=alpha;fctx.fillStyle=p.color;fctx.beginPath();fctx.arc(p.x,p.y,p.r*Math.max(.4,alpha),0,Math.PI*2);fctx.fill()}fctx.globalAlpha=1;particles=particles.filter(p=>p.age<p.life);if(particles.length)fireId=requestAnimationFrame(fireFrame)}
  function showToast(msg){toast.textContent=msg;toast.dataset.visible='true';clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>{toast.dataset.visible='false'},4200)}
  function showFireworks(real){if(mode!=='newyear')return;showToast(t(real?'happy':'preview'));if(reduce.matches||!fctx)return;stopFire();({w:fw,h:fh}=resizeCanvas(fire,fctx));for(const [x,y,k] of [[.25,.29,0],[.74,.26,.8],[.45,.48,1.6],[.83,.49,2.1],[.15,.52,3]])burst(x*fw,y*fh,k);lastFrame=performance.now();fireId=requestAnimationFrame(fireFrame)}
  async function clockSync(){try{const a=Date.now();const response=await fetch('/robots.txt?as-clock='+Math.floor(a/60000),{method:'HEAD',cache:'no-store',signal:AbortSignal.timeout(2500)});const b=Date.now();const raw=response.headers.get('Date');if(raw){const x=Date.parse(raw),delta=x-(a+b)/2;if(Number.isFinite(delta)&&Math.abs(delta)<20000){serverDelta=delta;clockSynced=true}}}catch{}}
  function tick(){const now=Date.now()+serverDelta,rem=Math.max(0,TARGET-now),days=Math.floor(rem/86400000),hrs=Math.floor(rem/3600000)%24,mins=Math.floor(rem/60000)%60,secs=Math.floor(rem/1000)%60,pad=n=>String(n).padStart(2,'0');byId('as-days').textContent=pad(days);byId('as-hours').textContent=pad(hrs);byId('as-minutes').textContent=pad(mins);byId('as-seconds').textContent=pad(secs);if(rem===0&&mode==='newyear'&&!hasFired&&!document.hidden&&now<TARGET+60000){hasFired=true;showFireworks(true)}lastDiff=rem;}
  window.addEventListener('resize',()=>{resizeWeather();updateMotion();updateHeaderOffset()},{passive:true});
  DOC.addEventListener('visibilitychange',()=>{if(DOC.hidden){stopWeather();stopTree();stopFire()}else{updateMotion();tick()}});
  reduce.addEventListener?.('change',()=>{applyControlLabels();updateMotion()});
  new MutationObserver(()=>{const next=language();if(next!==locale)updateLabels()}).observe(ROOT,{attributes:true,attributeFilter:['lang']});
  window.addEventListener('storage',ev=>{if(ev.key==='artsoul_language'||ev.key==='artsoul_lang')updateLabels()});
  /* ArtSoul Solstice v2: reversible snow details on every route.
     This touches only visual nodes, not business event handlers. */
  const scrollMist=elt('div',{id:'as-scroll-mist','aria-hidden':'true'});
  BODY.insertBefore(scrollMist,BODY.firstChild);
  const nodesSeen=new WeakSet();
  const selectors=[
    '.site-header .logo-link',
    '.site-header .site-primary-nav a',
    '.site-header .site-header-actions button',
    '.site-header .avatar-button',
    '.site-header .site-header-nav button',
    '.site-header .menu-button',
    '.site-header .mobile-menu-button',
    '.site-header .mobile-nav a',
    '.home-hero-actions a',
    '.site-page-container a.btn-main',
    '.site-page-container a.btn-secondary',
    '.site-page-container button.btn-main',
    '.site-page-container button.btn-secondary',
    '.site-page-container :is(.home-showcase,.profile-card,.auction-card,.collection-card,.artwork-card,.nft-card,.artwork-tile,.artwork-detail-card)',
    '.site-page-container .gallery article',
    '.site-page-container .gallery [data-artwork-id]',
    '.site-page-container .gallery [data-artwork-card]',
    '.site-page-container :is(.docs-card,.info-card,.feature-card,.collection-tile)'
  ];
  const targetSelector=selectors.join(',');
  function crownClass(el){
    if(el.matches('.site-header a,.site-header button'))return 'as-trim-nav';
    if(el.matches('a,button'))return 'as-trim-button';
    if(el.matches('.home-showcase,.docs-card,.info-card'))return 'as-trim-panel';
    return 'as-trim-card';
  }
  let detailCount=0;
  function decorateNode(el){
    if(nodesSeen.has(el)||el.closest('#as-scene-panel,#as-countdown-ribbon,#as-solstice-scene'))return;
    if(detailCount>175)return;
    if(!el.isConnected||el.closest('[hidden],[aria-hidden="true"],dialog,[role="dialog"]'))return;
    const style=getComputedStyle(el);
    if(style.display==='none')return;
    // Snow belongs on a real frame, never across unpadded bare text.
    const kind=crownClass(el);
    if(kind==='as-trim-card' &&
       (parseFloat(style.paddingTop)||0)<9 &&
       (parseFloat(style.borderTopLeftRadius)||0)<6 &&
       (parseFloat(style.borderTopWidth)||0)<1)return;
    nodesSeen.add(el);
    // Never rewrite or remove existing text, links, focus or handlers.
    if(style.position==='static')el.style.position='relative';
    el.classList.add('as-snow-trim',kind);
    const cap=elt('span',{'class':'as-snow-crown','aria-hidden':'true'});
    cap.innerHTML='<svg viewBox="0 0 320 34" preserveAspectRatio="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">'+
      '<path class="as-cap-base" d="M0 11 C15 9 27 5 40 9 C55 1 69 2 83 9 C99 5 113 3 124 8 C141 2 153 6 164 9 C180 2 197 3 209 8 C225 5 239 3 254 10 C268 4 287 6 297 9 C308 6 317 10 320 10 L320 16 C306 20 304 18 295 17 C292 27 286 28 283 18 C272 22 259 18 251 18 C243 23 230 19 219 18 C207 22 197 18 186 17 C180 30 170 30 172 17 C157 22 141 18 130 18 C116 23 107 20 95 18 C84 21 76 19 66 17 C60 30 53 31 53 18 C37 22 20 19 0 17 Z"/>'+
      '<path class="as-cap-shade" d="M0 16 C22 20 37 18 53 18 C53 31 60 30 66 17 C84 22 104 19 130 18 C142 21 157 22 172 17 C170 30 180 30 186 17 C205 22 222 18 251 18 C260 22 273 22 283 18 C286 28 292 27 295 17 C304 18 310 20 320 16 L320 19 C295 23 283 23 270 20 C249 26 238 22 219 22 C199 25 182 23 165 22 C141 24 111 25 95 21 C74 24 45 25 23 22 L0 20 Z"/>'+
      '<path class="as-cap-highlight" d="M12 11 C23 8 31 8 41 10 M112 9 C126 6 140 7 150 10 M218 10 C233 7 240 8 250 10 M286 10 C299 8 306 9 315 11"/>'+
      '</svg>';
    // Choose an object-specific snow silhouette instead of one flat banner.
    const rect=el.getBoundingClientRect();
    const radius=parseFloat(style.borderTopLeftRadius)||0;
    const isCircle=el.matches('button,.avatar-button')&&rect.width>=26&&rect.width<=84&&
      rect.height>=26&&Math.abs(rect.width-rect.height)<rect.width*.27&&radius>=rect.width*.30;
    if(isCircle){
      el.classList.add('as-trim-round');
      cap.innerHTML='<svg viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">'+
        '<path class="as-cap-base" d="M6 30 Q10 19 19 14 Q31 4 46 4 Q57 1 68 8 Q80 12 89 21 L94 31 Q84 24 77 27 Q69 22 60 20 Q57 33 52 25 L48 19 Q36 19 31 25 Q25 22 19 28 Z"/>'+
        '<path class="as-cap-shade" d="M9 29 Q23 15 36 15 Q49 10 63 17 Q81 20 91 30 L83 27 Q68 20 60 20 Q54 31 51 25 L47 20 Q32 19 20 28 Z"/>'+
        '<path class="as-cap-highlight" d="M18 18 Q34 5 48 7 M60 8 Q70 10 79 18"/>'+
        '</svg>';
    } else if(el.matches('.site-primary-nav a,.site-header .mobile-nav a')){
      el.classList.add('as-trim-text');
      const padTop=parseFloat(style.paddingTop)||0;
      el.style.setProperty('--as-rime-y',(padTop+1).toFixed(1)+'px');
      el.style.setProperty('--as-rime-x',((parseFloat(style.paddingLeft)||0)+1).toFixed(1)+'px');
      el.style.setProperty('--as-rime-right',((parseFloat(style.paddingRight)||0)+1).toFixed(1)+'px');
    } else if(el.matches('.site-header .logo-link')){
      el.classList.add('as-trim-logo');
      el.style.setProperty('--as-logo-frost-y',((parseFloat(style.paddingTop)||0)+1).toFixed(1)+'px');
    }
    el.appendChild(cap);
    // Gala decorations are a different material: pine needles, gold wire,
    // a little powder only on the actual edge; no frozen ice shelves.
    // A label is ink, not a shelf: put the holiday light cord under the glyphs.
    if(!el.matches('.site-header .logo-link')){
      const gala=elt('span',{'class':'as-holiday-detail','aria-hidden':'true'});
      const open='<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" ';
      if(isCircle){
        gala.classList.add('as-gala-round');
        gala.innerHTML=open+'viewBox="0 0 100 42" preserveAspectRatio="none">'+
          '<path class="as-gala-shadow" d="M14 25 Q25 9 45 7 Q65 5 85 24 L88 28 Q67 15 55 16 Q41 15 28 23 Q20 29 14 25Z"/>'+
          '<path class="as-gala-powder" d="M10 25 Q25 7 47 7 Q70 6 88 26 Q84 30 76 25 Q62 17 55 18 Q47 24 43 18 Q29 16 20 26 Q14 29 10 25Z"/>'+
          '<path class="as-gala-vine" d="M17 21 Q43 7 72 18 Q82 20 87 25"/>'+
          '<path class="as-gala-needle" d="M31 13L25 7 M35 12L37 5 M57 12L54 4 M67 15L75 8"/>'+
          '<circle class="as-gala-lamp" cx="42" cy="12" r="3.7"/><circle class="as-gala-ruby" cx="74" cy="20" r="3.2"/></svg>';
      }else if(el.matches('.site-primary-nav a,.site-header .mobile-nav a')){
        gala.classList.add('as-gala-nav');
        gala.innerHTML=open+'viewBox="0 0 120 15" preserveAspectRatio="none">'+
          '<path class="as-gala-wire" d="M3 3 Q33 12 60 5 Q89 12 117 4"/>'+
          '<path class="as-gala-needle" d="M22 8L17 3 M24 8L29 3 M87 9L83 4 M91 9L96 4"/>'+
          '<circle class="as-gala-ruby" cx="40" cy="8" r="3.3"/><circle class="as-gala-lamp" cx="73" cy="9" r="3.2"/></svg>';
      }else if(el.matches('a,button')){
        gala.classList.add('as-gala-button');
        gala.innerHTML=open+'viewBox="0 0 320 33" preserveAspectRatio="none">'+
          '<path class="as-gala-shadow" d="M1 19 Q19 3 47 8 Q63 10 79 22 Q67 19 56 18 Q39 13 24 22 Z M245 21 Q268 5 289 10 Q313 11 319 25 Q307 18 294 20 Q274 12 258 23Z"/>'+
          '<path class="as-gala-powder" d="M1 18 Q20 3 44 7 Q61 7 77 21 Q60 14 51 16 Q34 10 21 19 Q12 22 1 18Z M244 21 Q264 5 288 8 Q310 8 318 22 Q299 16 289 17 Q275 11 259 22Z"/>'+
          '<path class="as-gala-vine" d="M5 20 Q28 8 51 16 M275 15 Q300 8 315 19"/>'+
          '<path class="as-gala-needle" d="M30 12L25 4 M40 13L47 5 M287 12L281 5 M299 12L304 6"/>'+
          '<circle class="as-gala-lamp" cx="49" cy="17" r="4"/><circle class="as-gala-ruby" cx="277" cy="15" r="3.9"/></svg>';
      }else{
        gala.classList.add('as-gala-card');
        gala.innerHTML=open+'viewBox="0 0 320 33" preserveAspectRatio="none">'+
          '<path class="as-gala-powder" d="M0 11 Q18 1 37 4 Q50 5 68 16 Q48 9 34 13 Q13 10 0 16Z M248 15 Q267 1 290 5 Q307 4 320 13 L320 20 Q302 12 285 12 Q271 10 250 18Z"/>'+
          '<path class="as-gala-vine" d="M5 16 Q30 7 54 13 M269 12 Q292 8 316 17"/>'+
          '<path class="as-gala-needle" d="M29 9L22 2 M41 10L47 3 M287 9L282 2 M303 12L309 5"/>'+
          '<circle class="as-gala-lamp" cx="49" cy="12" r="3.5"/><circle class="as-gala-ruby" cx="278" cy="13" r="3.5"/></svg>';
      }
      el.appendChild(gala);
    }
    if(el.matches('.site-header .avatar-button')){
      el.classList.add('as-santa-anchor');
      const hat=elt('span',{'class':'as-santa-hat','aria-hidden':'true'});
      // Full folded felt cone, physical cuff overlapping the circle, and rounded pom.
      // The design is an original inline vector; pointer-events stay disabled.
      hat.innerHTML='<svg viewBox="0 0 150 122" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">'+
        '<defs><linearGradient id="as-v4-felt" x1=".18" y1="0" x2=".86" y2="1"><stop stop-color="#ff6563"/><stop offset=".42" stop-color="#c91b34"/><stop offset="1" stop-color="#6e081c"/></linearGradient><linearGradient id="as-v4-fur" x1="0" y1="0" x2=".15" y2="1"><stop stop-color="#fff"/><stop offset=".42" stop-color="#fffafa"/><stop offset="1" stop-color="#c9d5df"/></linearGradient><radialGradient id="as-v4-pom" cx=".28" cy=".23" r=".85"><stop stop-color="#fff"/><stop offset=".5" stop-color="#f5f4f0"/><stop offset="1" stop-color="#bdccd6"/></radialGradient></defs>'+
        '<path d="M25 83 C32 52 48 18 77 12 C96 7 105 19 109 32 C112 49 124 48 133 58 L126 80 C108 68 93 62 76 64 C52 67 38 78 25 83Z" fill="url(#as-v4-felt)" stroke="#7a1b2a" stroke-width="1.4"/>'+
        '<path d="M83 16 C104 12 108 38 118 50 C127 57 136 58 139 65 Q126 78 116 73 C111 53 100 47 88 44 C101 36 92 23 83 16Z" fill="#870c23" opacity=".61"/>'+
        '<path d="M35 72 C49 34 62 21 82 18" fill="none" stroke="#ffb1ab" opacity=".5" stroke-linecap="round" stroke-width="4.4"/>'+
        '<path d="M57 47 C65 37 73 36 83 37" stroke="#ef7180" stroke-width="1.4" opacity=".6" fill="none"/>'+
        '<path d="M124 65 C129 57 137 57 141 63 C148 64 151 72 146 79 C150 86 144 94 137 92 C132 99 121 95 120 89 C112 88 111 79 118 75 C116 70 119 65 124 65Z" fill="url(#as-v4-pom)" stroke="#b9c7d0" stroke-width="1.1"/>'+
        '<path d="M123 73 Q131 65 139 69" stroke="#fff" stroke-width="3.8" stroke-linecap="round" opacity=".93" fill="none"/>'+
        '<path d="M19 80 C29 72 44 68 61 69 C79 65 97 69 108 79 Q113 86 108 95 C94 92 82 85 67 88 Q44 91 21 99 Q15 98 17 90 Q14 86 19 80Z" fill="url(#as-v4-fur)" stroke="#c1d1d8" stroke-width="1.4"/>'+
        '<path d="M20 80 C29 77 33 77 39 79 C49 74 52 75 60 77 C71 74 78 75 88 78 C95 77 101 80 107 82" stroke="#fff" fill="none" stroke-width="4.5" stroke-linecap="round" opacity=".97"/>'+
        '<path d="M22 95 Q39 88 54 87 Q78 83 101 92" stroke="#a9bccb" fill="none" stroke-width="2.6" opacity=".57"/>'+
        '<path d="M34 80l2-3m14 3l2-3m17 1l1-2m17 5l1-2" stroke="#fff" stroke-width="1.2" opacity=".9"/>'+
        '<g fill="#fff" opacity=".76"><circle cx="65" cy="29" r="1.3"/><circle cx="48" cy="55" r=".9"/><circle cx="89" cy="30" r="1.1"/></g></svg>';
      el.appendChild(hat);
    }
    detailCount++;
  }
  function decorateSite(){
    const elements=DOC.querySelectorAll(targetSelector);
    for(const el of elements)decorateNode(el);
    for(const el of DOC.querySelectorAll('.site-page-container')){
      if(el.querySelector(':scope > .as-page-halo'))continue;
      if(getComputedStyle(el).position==='static')el.style.position='relative';
      el.prepend(elt('div',{'class':'as-page-halo','aria-hidden':'true'}));
    }
  }
  let decorTimer=0;
  function scheduleDecoration(){
    if(decorTimer)return;
    decorTimer=setTimeout(()=>{decorTimer=0;decorateSite()},210);
  }
  decorateSite();
  const domObserver=new MutationObserver(records=>{
    if(records.some(record=>[...record.addedNodes].some(n=>n.nodeType===1&&!n.matches?.('.as-snow-crown,.as-page-halo'))))scheduleDecoration();
  });
  domObserver.observe(BODY,{childList:true,subtree:true});
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
  resizeWeather();

  resizeWeather();updateLabels();applyMode();tick();setInterval(tick,1000);clockSync().then(tick);
  window.ArtSoulSeasonalPreview={getState:()=>({mode,snow,locale,timezone:'Europe/Warsaw',targetUtc:new Date(TARGET).toISOString(),clockSynced}),previewFireworks:()=>showFireworks(false),setMode:x=>{if(modes.includes(x)){mode=x;applyMode()}}};
})();
