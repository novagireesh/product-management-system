// Browser side of product field display and calculation rules: the same module the server uses,
// so pages show exactly what catalogues and the scan page show.
export {
  DEFAULT_CALC_RULES, LOADABILITY_ROUNDING, calcLoadability, cbmFromDimensions, formatDimensions, formatFieldValue, isCalculatedField,
  normaliseCalcRules, parseDimensionSets,
} from '../../../shared/product-fields.js';

import { formatFieldValue } from '../../../shared/product-fields.js';

/** Display text of a product's value for a field key ('' when empty). */
export const specText = (product, field) => formatFieldValue(field, product?.specs?.[field?.key]);
