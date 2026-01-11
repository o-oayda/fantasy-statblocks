# Fork-specific Changes

## Auto-calculated saves and skills
- Saves and skills can now be declared with shorthand entries inside inline statblocks. During rendering the plugin derives the final modifier using the creature's stats and the CR-based proficiency bonus.
- Legacy entries (`{ dexterity: 6 }`) and trait-style objects still work exactly as before, so existing statblocks do not need to change.
- A shared helper (`getProficiencyBonus`) exposes the CR → proficiency lookup, and ability modifiers can be accessed via `getAbilityModifier`. A skill-to-ability map powers the skill shorthand.

### New syntax
You can mix any of the following shapes inside the `saves` or `skillsaves` arrays:

1. **Legacy numeric objects** – `{ dexterity: 6 }` or `{ perception: 9 }`. These are rendered unchanged.
2. **Shorthand strings** – `- dexterity` or `- stealth`. The renderer assumes proficiency, looks up the relevant ability score, adds the CR-based proficiency bonus, and displays the computed value.
3. **Structured dictionaries** – for saves use:
   ```yaml
   saves:
     - ability: dexterity      # required ability name/alias
       proficient: true        # defaults to true
       expertise: true         # doubles the proficiency bonus
       bonus: 1                # extra flat modifier (optional)
       proficiencyBonus: 4     # override PB if the CR math shouldn't be used
   ```
   For skills use:
   ```yaml
   skillsaves:
     - skill: stealth          # required skill name
       ability: intelligence   # optional override; defaults to the standard skill ability
       proficient: true
       expertise: false
       bonus: 2
   ```
   Additional optional flags:
   - `multiplier` / `proficiencyMultiplier` (number) – replaces the standard proficiency/expertise multiplier (e.g., `0.5` for half proficiency).
   - `half`, `halfProficient`, or `halfProficiency` (boolean) – shorthand for setting the multiplier to `0.5`.
   - `pb` – alias for `proficiencyBonus`.

If a save/skill entry is a trait object (contains `name`/`desc`) it is still rendered verbatim, so you can interleave descriptive text with auto-calculated values.

> **Note:** The shorthand computation currently assumes 5e math (CR-derived proficiency bonuses and the standard 5e skill list). Other layouts/systems keep working by continuing to provide explicit numbers, but if broader system support is needed this logic should be hoisted somewhere system-aware instead of living in `statblock.ts`.
