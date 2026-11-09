// src/constants/brandConstants.js
// Limits for the admin brand form. The form (client/src/pages/admin/BrandForm.jsx)
// uses the same numbers - change both together.

// Brand name: required, 2-50 characters.
const NAME_LIMITS = Object.freeze({ MIN_LENGTH: 2, MAX_LENGTH: 50 });

// Brand description: optional, 500 characters at most.
const DESCRIPTION_LIMITS = Object.freeze({ MAX_LENGTH: 500 });

module.exports = { NAME_LIMITS, DESCRIPTION_LIMITS };
