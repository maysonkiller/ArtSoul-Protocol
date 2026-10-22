import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { artworkShareDetails, artworkShareIntent } from '../src/features/artwork/artwork-sharing.js';
import { createArtworkPreviewHandler, renderArtworkPreview } from '../src/api/artwork-share-preview.js';
const artwork = {id:'v41:84532:34', title:'A quiet sea', creator_name:'Artist',
    creator:'0x'+'1'.repeat(40), media_type:'image', image:'https://ipfs.io/ipfs/'+'b'+'a'.repeat(30)+'/image.png',
    status:'auction', auction_end_time:'2099-01-01T00:00:00Z', start_price:'0.001', current_bid:'0', minted:false};
const response = () => ({code:0,headers:{},body:'',setHeader(k,v){this.headers[k]=v;},
    status(code){this.code=code;return this;},end(body=''){this.body=body;return this;}});

test('share draft has canonical work identity, creator and testnet auction context', () => {
    const value=artworkShareDetails(artwork);
    assert.equal(value.url,'https://artsoulprotocol.com/artwork/34');
    assert.match(value.draft,/A quiet sea.*by Artist/);
    assert.match(value.context,/Live art auction.*Starting price: 0.001 test ETH.*Base Sepolia testnet/);
    assert.doesNotMatch(value.draft,/NFT/,'a registered work is not minted yet');
    const intent=new URL(artworkShareIntent(artwork));
    assert.equal(intent.origin,'https://x.com');
    assert.equal(intent.searchParams.get('url'),value.url);
    assert.equal(intent.searchParams.get('text'),value.draft);
    assert.equal(new URL(intent.searchParams.get('url')).search,'','no action, wallet, session or tracking query is shared');
});

test('prices and lifecycle labels do not imply that an expired auction is still live', () => {
    assert.match(artworkShareDetails({...artwork,current_bid:'0.000000000000000001'}).context,/Current bid: 0.000000000000000001 test ETH/);
    assert.doesNotMatch(artworkShareDetails({...artwork,auction_end_time:'2020-01-01'}).context,/Live|Starting price/);
    assert.doesNotMatch(artworkShareDetails({...artwork,auction_end_time:null}).context,/Live/);
    assert.match(artworkShareDetails({...artwork,minted:true,canonical_floor:'0.011'}).context,/Art NFT.*Floor: 0.011/);
    assert.match(artworkShareDetails({...artwork,minted:true,status:'for_sale',sale_price:'0.02'}).context,/NFT for sale.*Price: 0.02/);
    assert.doesNotMatch(artworkShareDetails({...artwork,status:'settlement_pending'}).context,/NFT|Starting price/);
    assert.doesNotMatch(artworkShareDetails({...artwork,start_price:'NaN'}).draft,/NaN/);
});

test('legacy artwork identity stays explicit and invalid or hidden works cannot be shared', () => {
    assert.equal(artworkShareDetails({...artwork,id:'v41:11155111:34'}).url,
        'https://artsoulprotocol.com/artwork?id=v41%3A11155111%3A34');
    for(const id of ['pending:34','v41:8453:34','v41:84532:0','v41:84532:34?action=donate']) {
        assert.equal(artworkShareIntent({...artwork,id}), '');
    }
    assert.equal(artworkShareIntent({...artwork,moderation_hidden:true}), '');
});

test('long Unicode titles and creator names leave room for a standard post and URL', () => {
    const value=artworkShareDetails({...artwork,title:'界'.repeat(200),creator_name:'界'.repeat(100),
        current_bid:'12345678901234567890.123456789012345678'});
    const conservativeWeight=Array.from(value.draft).reduce((sum,c)=>sum+(c.codePointAt(0)>127?2:1),0);
    assert.ok(conservativeWeight+24<=280,String(conservativeWeight));
    assert.match(value.draft,/Base Sepolia testnet/);
});

test('crawler HTML exposes the actual work image and escapes every user-controlled field', () => {
    const html=renderArtworkPreview({...artwork,title:'"><script>alert(1)</script>',creator_name:'A & B'});
    assert.match(html,/name="twitter:card" content="summary_large_image"/);
    assert.ok(html.includes(`name="twitter:image" content="${artwork.image}"`));
    assert.doesNotMatch(html,/<script>|artsoul-social-preview/);
    assert.match(html,/&lt;script&gt;/);
    assert.match(html,/A &amp; B/);
    const unsafe=renderArtworkPreview({...artwork,image:'https://127.0.0.1/private'});
    assert.doesNotMatch(unsafe,/127\.0\.0\.1/);
    assert.match(unsafe,/default-avatar\.png/);
    assert.match(renderArtworkPreview({...artwork,media_type:'audio',image:null,media_url:'https://example.com/music.mp3'}),
        /twitter:image:alt" content="ArtSoul"/,'missing audio cover is identified as the site image');
});

test('preview always reads a guest projection without caller cookies or extra query filters', async () => {
    let seen;
    const handler=createArtworkPreviewHandler(async(req,res)=>{
        seen=req;res.status(200).json({success:true,data:[artwork]});
    });
    const res=response();
    await handler({method:'GET',query:{id:'34',action:'report',wallet:'secret'},headers:{cookie:'staff-session',host:'attacker.test'}},res);
    assert.equal(res.code,200);
    assert.deepEqual(seen,{method:'GET',query:{id:'34'},headers:{}});
    assert.equal(res.headers['Cache-Control'],'private, no-store');
    assert.doesNotMatch(res.body,/attacker|secret|staff-session/);
});

test('preview refuses missing, hidden, mismatched, malformed and failed lookups', async () => {
    for(const data of [[],[{...artwork,moderation_hidden:true}],[{...artwork,id:'v41:84532:35'}]]) {
        const res=response();
        await createArtworkPreviewHandler(async(req,res)=>res.status(200).json({success:true,data}))({method:'GET',query:{id:'34'}},res);
        assert.equal(res.code,404);assert.equal(res.body,'');
    }
    let reads=0;
    const handler=createArtworkPreviewHandler(async(req,res)=>{reads++;res.status(500).json({success:false});});
    for(const id of [['34','35'],'../34','0','v41:8453:34']) {
        const res=response();await handler({method:'GET',query:{id}},res);assert.equal(res.code,404);
    }
    const post=response();await handler({method:'POST',query:{id:'34'}},post);assert.equal(post.code,405);
    assert.equal(reads,0);
    const failed=response();await handler({method:'GET',query:{id:'34'}},failed);assert.equal(failed.code,503);
});

test('HEAD resolves the same public identity and sends no HTML body', async () => {
    const res=response();
    await createArtworkPreviewHandler(async(req,res)=>res.status(200).json({success:true,data:[artwork]}))({method:'HEAD',query:{id:'34'}},res);
    assert.equal(res.code,200);assert.equal(res.body,'');
});

test('crawler routing precedes normal artwork routing without changing human entry points', () => {
    const {rewrites,redirects}=JSON.parse(fs.readFileSync('vercel.json','utf8'));
    const bots=rewrites.filter(route=>route.destination.startsWith('/api/artwork-preview'));
    assert.equal(bots.length,1);
    const legacy=redirects.find(route=>route.source==='/artwork');
    assert.equal(legacy.destination,'/artwork/:artworkId');
    assert.equal(legacy.permanent,false);
    const idRule=legacy.has.find(rule=>rule.type==='query');
    assert.equal(idRule.key,'id');
    const idPattern=new RegExp('^'+idRule.value+'$');
    for(const id of ['34','v41:84532:34','v41:11155111:34']) assert.equal(id.match(idPattern).groups.artworkId,id);
    for(const id of ['../34','https://example.com','v41:8453:34']) assert.equal(idPattern.test(id),false);
    for(const route of [...bots,legacy]) {
        const condition=route.has[0];
        assert.equal(condition.key,'user-agent');
        const re=new RegExp(condition.value);
        assert.ok(re.test('Twitterbot/1.0'));
        assert.ok(!re.test('Mozilla/5.0 AppleWebKit/605.1.15 Safari/604.1'));
    }
    assert.ok(rewrites.indexOf(bots[0])<rewrites.findIndex(route=>route.destination==='/artwork?id=:id'));
});
