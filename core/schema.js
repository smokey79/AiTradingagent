export const validatePosition = (pos) => { if (!pos || typeof pos.size !== "number") { throw new Error("Invalid position object"); } return pos; };
