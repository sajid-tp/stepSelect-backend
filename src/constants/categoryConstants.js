const ICON_CLASS_LIMITS = Object.freeze({ MIN_LENGTH: 3, MAX_LENGTH: 100 });

const ICON_CLASS_REGEX = /^[A-Za-z0-9 -]+$/;

const NAME_LIMITS = Object.freeze({ MIN_LENGTH: 2, MAX_LENGTH: 50 });

const DESCRIPTION_LIMITS = Object.freeze({ MAX_LENGTH: 500 });

module.exports = { ICON_CLASS_LIMITS, ICON_CLASS_REGEX, NAME_LIMITS, DESCRIPTION_LIMITS };
