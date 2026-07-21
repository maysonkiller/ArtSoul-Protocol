import { allowMethods, sendError } from '../../backend.js';
import { readReportingConfig } from '../../reporting-config.js';

function readPublicConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    const error = new Error('Public Supabase configuration is not available');
    error.statusCode = 500;
    error.code = 'PUBLIC_CONFIG_MISSING';
    throw error;
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    reportingEnabled: readReportingConfig().enabled
  };
}

export default function publicConfigHandler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({
      success: true,
      ...readPublicConfig()
    });
  } catch (error) {
    return sendError(res, error);
  }
}
