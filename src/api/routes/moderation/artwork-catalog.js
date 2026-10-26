import { allowMethods, sendError } from '../../backend.js';
import { getModerationAccess } from '../../moderation-access.js';
import { requireProtocolAdminEnabled } from '../../protocol-admin-config.js';
import { catalogArtworkId, readAdminArtworkCatalog } from '../../admin-artwork-catalog.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if (!allowMethods(req,res,['GET'])) return;
  try {
    requireProtocolAdminEnabled();
    await getModerationAccess(req,{strict:true});
    const before = req.query?.before;
    if (before !== undefined && !catalogArtworkId(before)) {
      return res.status(400).json({error:'INVALID_CATALOG_CURSOR',message:'Choose a valid catalog page.'});
    }
    const data = await readAdminArtworkCatalog({before:before ?? null});
    await getModerationAccess(req,{strict:true});
    return res.status(200).json({success:true,data});
  } catch(error) { sendError(res,error); }
}
