import '../../ui/components/index.js';
import { installPublicContractRuntime } from './public-contract-runtime.js?v=1';

installPublicContractRuntime(() => import('../../index.js'));
