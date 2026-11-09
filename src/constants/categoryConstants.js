// src/constants/categoryConstants.js
// Limits for the category icon class. The admin category form (client/src/pages/admin/CategoryForm.jsx)
// uses the same numbers - change both together.

const ICON_CLASS_LIMITS = Object.freeze({ MIN_LENGTH: 3, MAX_LENGTH: 100 });

// Letters, numbers, spaces and hyphens only
const ICON_CLASS_REGEX = /^[A-Za-z0-9 -]+$/;

// Category name: required, 2-50 characters.
// The admin category form (client/src/pages/admin/CategoryForm.jsx) uses the same numbers - change both together.
const NAME_LIMITS = Object.freeze({ MIN_LENGTH: 2, MAX_LENGTH: 50 });

// Category description: optional, 500 characters at most.
// The admin category form (client/src/pages/admin/CategoryForm.jsx) uses the same numbers - change both together.
const DESCRIPTION_LIMITS = Object.freeze({ MAX_LENGTH: 500 });

module.exports = { ICON_CLASS_LIMITS, ICON_CLASS_REGEX, NAME_LIMITS, DESCRIPTION_LIMITS };
