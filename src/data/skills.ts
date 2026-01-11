import type { ability } from "index";

export const SKILL_TO_ABILITY: Record<string, ability> = {
    acrobatics: "dexterity",
    "animal handling": "wisdom",
    arcana: "intelligence",
    athletics: "strength",
    deception: "charisma",
    history: "intelligence",
    insight: "wisdom",
    intimidation: "charisma",
    investigation: "intelligence",
    medicine: "wisdom",
    nature: "intelligence",
    perception: "wisdom",
    performance: "charisma",
    persuasion: "charisma",
    religion: "intelligence",
    "sleight of hand": "dexterity",
    stealth: "dexterity",
    survival: "wisdom"
};
