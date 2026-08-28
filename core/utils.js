export const safeJSON = (obj) => { try { return JSON.stringify(obj, null, 2); } catch { return "{}"; } };
