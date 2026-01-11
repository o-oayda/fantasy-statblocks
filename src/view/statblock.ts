import {
    App,
    ButtonComponent,
    Modal,
    TFile,
    getFrontMatterInfo,
    parseYaml,
    stringifyYaml
} from "obsidian";
import { Layout5e } from "src/layouts/basic 5e/basic5e";
import { MarkdownRenderChild } from "obsidian";
import type { ability, Monster, StatblockParameters, Trait } from "../../index";

import Statblock from "./Statblock.svelte";
import type StatBlockPlugin from "src/main";

import fastCopy from "fast-copy";
import type {
    CollapseItem,
    GroupItem,
    IfElseItem,
    InlineItem,
    JavaScriptItem,
    Layout,
    LayoutItem,
    StatblockItem
} from "src/layouts/layout.types";
import { append, getAbilityModifier } from "src/util/util";
import { Linkifier } from "src/parser/linkify";
import { Bestiary } from "src/bestiary/bestiary";
import copy from "fast-copy";
import { getProficiencyBonus } from "src/data/constants";
import { SKILL_TO_ABILITY } from "src/data/skills";

const ABILITIES: ability[] = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma"
];

const ABILITY_ALIASES: Record<string, ability> = {
    str: "strength",
    strength: "strength",
    dex: "dexterity",
    dexterity: "dexterity",
    con: "constitution",
    constitution: "constitution",
    int: "intelligence",
    intelligence: "intelligence",
    wis: "wisdom",
    wisdom: "wisdom",
    cha: "charisma",
    charisma: "charisma"
};

type ComputedEntrySpec = {
    proficient?: boolean;
    expertise?: boolean;
    multiplier?: number;
    bonus?: number;
};

type RendererParameters = {
    container: HTMLElement;
    plugin: StatBlockPlugin;
    context?: string;
    layout?: Layout;
} & (
    | {
          monster: Monster;
      }
    | {
          params: Partial<StatblockParameters>;
      }
);

export default class StatBlockRenderer extends MarkdownRenderChild {
    topBar!: HTMLDivElement;
    bottomBar!: HTMLDivElement;
    loaded: boolean = false;
    statblockEl!: HTMLDivElement;
    contentEl!: HTMLDivElement;
    container: HTMLElement;
    monster!: Monster;
    plugin: StatBlockPlugin;
    params!: Partial<StatblockParameters>;
    context: string;
    layout!: Layout;
    constructor(
        public rendererParameters: RendererParameters,
        public icons = true
    ) {
        super(rendererParameters.container);

        this.container = rendererParameters.container;
        this.plugin = rendererParameters.plugin;
        this.context = rendererParameters.context ?? "";

        this.setCreature(rendererParameters);

        this.setLayout();

        this.init();
    }
    setLayout() {
        this.layout =
            this.rendererParameters.layout ??
            this.plugin.manager
                .getAllLayouts()
                .find(
                    (layout) =>
                        layout.name ==
                            (this.params.layout ?? this.monster.layout) ||
                        layout.name ==
                            (this.params.statblock ?? this.monster.statblock)
                ) ??
            this.plugin.manager.getDefaultLayout();
    }
    get canSave() {
        return "name" in this.params;
    }

    async build(): Promise<Monster> {
        let built: Partial<Monster> = Object.assign(
            {},
            this.monster ?? {},
            this.params ?? {}
        );

        if (!Object.values(built).length) {
            built = Object.assign({}, built, {
                note: this.context
            });
        }
        if (built.note) {
            const note = Array.isArray(built.note)
                ? (<string[]>built.note).flat(Infinity).pop()
                : built.note;
            const file =
                await this.plugin.app.metadataCache.getFirstLinkpathDest(
                    `${note}`,
                    this.context ?? ""
                );
            if (file && file instanceof TFile) {
                const info = getFrontMatterInfo(
                    await this.plugin.app.vault.cachedRead(file)
                );
                if (info.exists) {
                    Object.assign(
                        built,
                        fastCopy(
                            parseYaml(
                                Linkifier.transformYamlSource(info.frontmatter)
                            ) ?? {}
                        ),
                        this.params
                    );
                }
            }
        }
        if ("image" in built) {
            if (Array.isArray(built.image)) {
                built.image = built.image.flat(2).join("");
            }
        }

        const extensions = Bestiary.getExtensions(built, new Set());
        /**
         * At this point, the built creature has been fully resolved from all
         * extensions and in-memory creature definitions.
         */
        for (const extension of extensions.reverse()) {
            built = Object.assign(built, extension);
        }
        built = Object.assign(built, this.monster ?? {}, this.params ?? {});

        /**
         * Traits logic:
         * Defined in Params: ALWAYS SHOW
         * then, defined in memory
         * then, defined via extension
         *
         * Traits defined using `trait+: ...` will always just add to the underlying trait.
         */

        for (const block of this.unwrapBlocks(this.layout.blocks)) {
            if (!("properties" in block)) continue;
            for (let property of block.properties) {
                /** Ignore properties that aren't in the final built creature. */
                if (
                    !(property in built) &&
                    !(`${property}+` in built) &&
                    !(`${property}-` in built)
                ) {
                    continue;
                }
                switch (block.type) {
                    case "traits": {
                        /**
                         * Traits can be defined directly, as additive (+) or subtractive (-).
                         *
                         * Directly defined traits can be overidden by name up the extension tree.
                         * Parameters > `creature` > `extends`
                         * Directly defined parameter traits are *always shown*.
                         *
                         * Additive traits are *always* displayed, no matter where they originate.
                         *
                         * Subtractive traits are *always* removed, unless the trait is directly defined in the parameters.
                         * Subtractive traits only work on directly defined traits.
                         *
                         */
                        const $TRAIT_MAP: Map<string, Trait> = new Map();
                        const $ADDITIVE_TRAITS: Trait[] = [];

                        /**
                         * Resolve extension traits first.
                         */
                        for (const creature of [...extensions]) {
                            /**
                             * Deleted traits. These are always removed.
                             */
                            for (const trait of getTraitsList(
                                `${property}-` as keyof Monster,
                                creature
                            )) {
                                $TRAIT_MAP.delete(trait.name);
                            }
                            /**
                             * Directly defined traits.
                             *
                             * Because these can be overridden, they go into a map by name.
                             */
                            for (const trait of getTraitsList(
                                property,
                                creature
                            )) {
                                $TRAIT_MAP.set(trait.name, trait);
                            }

                            /**
                             * Additive traits. These traits are always shown.
                             */
                            for (const trait of getTraitsList(
                                `${property}+` as keyof Monster,
                                creature
                            )) {
                                $ADDITIVE_TRAITS.push(trait);
                            }
                        }
                        Object.assign(built, {
                            [property]: [
                                ...$TRAIT_MAP.values(),
                                ...$ADDITIVE_TRAITS
                            ]
                        });
                        break;
                    }
                    case "saves": {
                        /** TODO: Reimplement combinatorial saves */
                        let saves: {
                            [x: string]: any;
                        }[] =
                            (built[property] as {
                                [x: string]: any;
                            }[]) ?? [];
                        if (
                            property in built &&
                            !Array.isArray(built[property]) &&
                            typeof built[property] == "object"
                        ) {
                            saves = Object.entries(built[property] ?? {}).map(
                                ([key, value]) => {
                                    return { [key]: value };
                                }
                            );
                        }
                        Object.assign(built, {
                            [property]: saves
                        });
                        let additive: {
                            [x: string]: any;
                        }[] = [];
                        if (
                            `${property}+` in built &&
                            !Array.isArray(
                                built[`${property}+` as keyof Monster]
                            ) &&
                            typeof built[`${property}+` as keyof Monster] ==
                                "object"
                        ) {
                            additive = Object.entries(
                                built[property] ?? {}
                            ).map(([key, value]) => {
                                return { [key]: value };
                            });
                        }
                        if (additive.length) {
                            Object.assign(built, {
                                [property]: append(
                                    built[property] as { [x: string]: any }[],
                                    additive
                                )
                            });
                        }
                        if (
                            (property === "saves" ||
                                property === "skillsaves") &&
                            Array.isArray(built[property])
                        ) {
                            Object.assign(built, {
                                [property]: this.normalizeSavingLikeEntries(
                                    property as "saves" | "skillsaves",
                                    built[property] as { [x: string]: any }[],
                                    built
                                )
                            });
                        }
                        break;
                    }
                    default: {
                        if (`${property}+` in built && property in built) {
                            const additive = append(
                                built[property] as string | any[],
                                built[`${property}+` as keyof Monster] as
                                    | string
                                    | any[]
                            );
                            if (additive) {
                                Object.assign(built, {
                                    [property]: additive
                                });
                            }
                        }
                    }
                }
            }
        }

        built = this.transformLinks(built);

        if ("image" in built && Array.isArray(built.image)) {
            built.image = built.image.flat(2).join("");
        }

        return built as Monster;
    }

    /**
     * This is used to return a list of "saves" or "traits" block in the layout.
     */
    unwrapBlocks(
        blocks: StatblockItem[]
    ): Exclude<
        StatblockItem,
        | GroupItem
        | InlineItem
        | IfElseItem
        | JavaScriptItem
        | CollapseItem
        | LayoutItem
    >[] {
        let ret: Exclude<
            StatblockItem,
            | GroupItem
            | InlineItem
            | IfElseItem
            | JavaScriptItem
            | CollapseItem
            | LayoutItem
        >[] = [];
        for (const block of blocks) {
            switch (block.type) {
                case "group":
                case "inline":
                case "collapse": {
                    ret.push(...this.unwrapBlocks(block.nested));
                    break;
                }
                case "layout":
                case "ifelse":
                case "javascript": {
                    continue;
                }
                default:
                    ret.push(block);
                    break;
            }
        }

        return ret;
    }

    private normalizeSavingLikeEntries(
        property: "saves" | "skillsaves",
        entries: { [x: string]: any }[],
        creature: Partial<Monster>
    ) {
        const abilityScores = this.getAbilityScoreMap(creature);
        const proficiency = getProficiencyBonus(creature.cr);
        const isSkill = property === "skillsaves";
        return entries.map((entry) =>
            this.normalizeSaveEntry(entry, isSkill, abilityScores, proficiency)
        );
    }

    private normalizeSaveEntry(
        entry: any,
        isSkill: boolean,
        abilityScores: Record<ability, number>,
        proficiency: number
    ) {
        if (entry == null) return entry;
        if (typeof entry === "string") {
            return isSkill
                ? this.computeSkillFromString(entry, abilityScores, proficiency)
                : this.computeAbilityFromString(
                      entry,
                      abilityScores,
                      proficiency
                  );
        }
        if (typeof entry !== "object") return entry;
        if ("desc" in entry && entry.desc) return entry;
        const legacyEntry = this.tryLegacyEntry(entry);
        if (legacyEntry) return legacyEntry;
        if (isSkill && "skill" in entry) {
            return this.computeSkillFromObject(
                entry,
                abilityScores,
                proficiency
            );
        }
        if (!isSkill && ("ability" in entry || "save" in entry)) {
            return this.computeAbilityFromObject(
                entry,
                abilityScores,
                proficiency
            );
        }
        return entry;
    }

    private tryLegacyEntry(entry: Record<string, any>) {
        const keys = Object.keys(entry);
        if (keys.length !== 1) return null;
        const [key] = keys;
        const value = this.toNumber(entry[key]);
        if (value == null) return null;
        return { [key]: value };
    }

    private computeSkillFromString(
        value: string,
        abilityScores: Record<ability, number>,
        proficiency: number
    ) {
        const label = this.normalizeSkillLabel(value);
        if (!label) return value;
        const ability = this.getSkillAbility(label);
        if (!ability) return value;
        return this.buildComputedEntry(
            label,
            ability,
            abilityScores,
            proficiency,
            { proficient: true }
        );
    }

    private computeSkillFromObject(
        entry: Record<string, any>,
        abilityScores: Record<ability, number>,
        proficiency: number
    ) {
        const label = this.normalizeSkillLabel(entry.skill);
        if (!label) return entry;
        const ability = this.getSkillAbility(
            label,
            typeof entry.ability === "string" ? entry.ability : undefined
        );
        const spec: ComputedEntrySpec = {
            proficient: this.toBoolean(entry.proficient, true),
            expertise: this.toBoolean(entry.expertise, false),
            multiplier: this.extractMultiplier(entry),
            bonus: this.extractBonus(entry)
        };
        const profBonus = this.resolveProficiency(entry, proficiency);
        return this.buildComputedEntry(
            label,
            ability,
            abilityScores,
            profBonus,
            spec
        );
    }

    private computeAbilityFromString(
        value: string,
        abilityScores: Record<ability, number>,
        proficiency: number
    ) {
        const ability = this.normalizeAbilityName(value);
        if (!ability) return value;
        return this.buildComputedEntry(
            ability,
            ability,
            abilityScores,
            proficiency,
            { proficient: true }
        );
    }

    private computeAbilityFromObject(
        entry: Record<string, any>,
        abilityScores: Record<ability, number>,
        proficiency: number
    ) {
        const ability =
            this.normalizeAbilityName(entry.ability) ??
            this.normalizeAbilityName(entry.save);
        if (!ability) return entry;
        const spec: ComputedEntrySpec = {
            proficient: this.toBoolean(entry.proficient, true),
            expertise: this.toBoolean(entry.expertise, false),
            multiplier: this.extractMultiplier(entry),
            bonus: this.extractBonus(entry)
        };
        const profBonus = this.resolveProficiency(entry, proficiency);
        return this.buildComputedEntry(
            ability,
            ability,
            abilityScores,
            profBonus,
            spec
        );
    }

    private buildComputedEntry(
        label: string,
        ability: ability | null,
        abilityScores: Record<ability, number>,
        proficiency: number,
        spec: ComputedEntrySpec
    ) {
        const abilityMod =
            ability != null ? getAbilityModifier(abilityScores[ability]) : 0;
        const multiplier =
            spec.multiplier ??
            (spec.expertise ? 2 : spec.proficient === false ? 0 : 1);
        const bonus = spec.bonus ?? 0;
        return {
            [label]: abilityMod + proficiency * multiplier + bonus
        };
    }

    private getAbilityScoreMap(creature: Partial<Monster>) {
        const scores: Record<ability, number> = {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10
        };
        const stats = Array.isArray(creature.stats) ? creature.stats : [];
        for (let index = 0; index < ABILITIES.length; index++) {
            const value = stats[index];
            if (typeof value === "number") {
                scores[ABILITIES[index]] = value;
            }
        }
        return scores;
    }

    private normalizeSkillLabel(skill?: string) {
        if (!skill) return "";
        return skill.toString().trim().toLowerCase().replace(/\s+/g, " ");
    }

    private getSkillAbility(skill: string, override?: string) {
        if (override) {
            const normalized = this.normalizeAbilityName(override);
            if (normalized) return normalized;
        }
        return SKILL_TO_ABILITY[skill] ?? null;
    }

    private normalizeAbilityName(value?: string) {
        if (!value) return null;
        let key = value.toString().trim().toLowerCase();
        key = key.replace(/\s+saving throw$/, "").replace(/\s+save$/, "");
        return ABILITY_ALIASES[key] ?? null;
    }

    private resolveProficiency(entry: Record<string, any>, fallback: number) {
        const override =
            this.toNumber(entry.proficiencyBonus ?? entry.pb) ?? null;
        return override ?? fallback;
    }

    private extractMultiplier(entry: Record<string, any>) {
        const multiplier =
            this.toNumber(entry.proficiencyMultiplier ?? entry.multiplier) ??
            null;
        if (multiplier != null) return multiplier;
        if (
            entry.half === true ||
            entry.halfProficient === true ||
            entry.halfProficiency === true
        ) {
            return 0.5;
        }
        return undefined;
    }

    private extractBonus(entry: Record<string, any>) {
        const fields = ["bonus", "mod", "modifier", "adjustment"];
        for (const field of fields) {
            const value = this.toNumber(entry[field]);
            if (value != null) {
                return value;
            }
        }
        return 0;
    }

    private toNumber(value: any) {
        if (value == null || value === "") return null;
        const parsed = Number(value);
        return isNaN(parsed) ? null : parsed;
    }

    private toBoolean(value: any, fallback: boolean) {
        if (value == null) return fallback;
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (["true", "yes", "1"].includes(normalized)) return true;
            if (["false", "no", "0"].includes(normalized)) return false;
        }
        return Boolean(value);
    }

    setCreature(
        params:
            | {
                  monster: Monster;
              }
            | {
                  params: Partial<StatblockParameters>;
              }
    ) {
        if ("params" in params) {
            this.params = params.params;
            this.monster = Object.assign(
                {},
                Bestiary.get(this.params.monster) ??
                    Bestiary.get(this.params.creature)
            );
        } else {
            this.params = {};
            this.monster = params.monster;
        }
    }

    $ui!: Statblock;
    async init() {
        this.containerEl.empty();
        this.monster = (await this.build()) as Monster;
        this.$ui = new Statblock({
            target: this.containerEl,
            props: {
                context: this.context,
                monster: this.monster,
                statblock: this.layout.blocks,
                layout: this.layout,
                plugin: this.plugin,
                renderer: this,
                canSave: this.canSave,
                icons: this.icons ?? true
            }
        });
        this.$ui.$on("save", async () => {
            if (
                Bestiary.hasCreature(this.monster.name) &&
                !(await confirmWithModal(
                    this.plugin.app,
                    "This will overwrite an existing monster in settings. Are you sure?"
                ))
            )
                return;
            this.plugin.saveMonster({
                ...fastCopy(this.monster),
                source: this.monster.source ?? "Homebrew",
                layout: this.layout.name
            } as Monster);
        });

        this.$ui.$on("export", () => {
            this.plugin.exportAsPng(
                this.monster.name,
                this.containerEl.firstElementChild!
            );
        });

        let extensionNames = Bestiary.getExtensionNames(
            this.monster,
            new Set()
        );
        this.plugin.registerEvent(
            this.plugin.app.workspace.on(
                "fantasy-statblocks:bestiary:creature-added",
                async (creature) => {
                    if (extensionNames.includes(creature.name)) {
                        this.monster = copy(creature);
                        this.monster = await this.build();
                        this.$ui.$set({ monster: this.monster });
                    }
                }
            )
        );
    }
    transformLinks(monster: Partial<Monster>): Partial<Monster> {
        const built = parseYaml(
            Linkifier.transformYamlSource(
                stringifyYaml(monster).replace(/\\#/g, "#")
            )
        );
        return built;
    }
}

export async function confirmWithModal(
    app: App,
    text: string,
    buttons: { cta: string; secondary: string } = {
        cta: "Yes",
        secondary: "No"
    }
): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const modal = new ConfirmModal(app, text, buttons);
        modal.onClose = () => {
            resolve(modal.confirmed);
        };
        modal.open();
    });
}

export class ConfirmModal extends Modal {
    constructor(
        app: App,
        public text: string,
        public buttons: { cta: string; secondary: string }
    ) {
        super(app);
    }
    confirmed: boolean = false;
    async display() {
        new Promise((resolve) => {
            this.contentEl.empty();
            this.contentEl.addClass("confirm-modal");
            this.contentEl.createEl("p", {
                text: this.text
            });
            const buttonEl = this.contentEl.createDiv(
                "fantasy-calendar-confirm-buttons"
            );
            new ButtonComponent(buttonEl)
                .setButtonText(this.buttons.cta)
                .setCta()
                .onClick(() => {
                    this.confirmed = true;
                    this.close();
                });
            new ButtonComponent(buttonEl)
                .setButtonText(this.buttons.secondary)
                .onClick(() => {
                    this.close();
                });
        });
    }
    onOpen() {
        this.display();
    }
}

function getTraitsList(
    property: keyof Monster,
    obj: Partial<Monster>
): Trait[] {
    const traitArray: Trait[] = [];
    if (property in obj && Array.isArray(obj[property])) {
        for (const trait of obj[property] as any[]) {
            if (
                !Array.isArray(trait) &&
                typeof trait == "object" &&
                "name" in trait
            ) {
                traitArray.push(trait);
            }
            if (Array.isArray(trait) && trait.length >= 1) {
                traitArray.push({
                    name: trait[0],
                    desc: trait.slice(1).join("")
                });
            }
        }
    }
    return traitArray;
}
