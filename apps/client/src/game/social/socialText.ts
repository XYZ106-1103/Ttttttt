/**
 * Turning social data (character keys, guild ids, item/monster ids, line ids) into text in the
 * player's language. The simulation never stores display text, only ids.
 */
import {
  itemRegistry,
  registerOf,
  type RelationLabel,
  relationLabel,
  type Tone,
  toneOf,
} from '@world/shared';
import { getLanguage, t } from '../../i18n';
import type { ClientSim } from '../sim/ClientSim';

const NAME_KEYS = new Set(['other', 'name', 'who', 'a', 'b']);

export function nameOf(sim: ClientSim, key: string): string {
  if (key === 'player' || key === sim.selfKey) return sim.player.name;
  const a = sim.adventurers.byKey(key);
  if (!a) return sim.characterByKey(key)?.name ?? key;
  return getLanguage() === 'en' ? a.profile.name.en : a.profile.name.ko;
}

export function guildName(sim: ClientSim, id: string): string {
  const g = sim.society.guilds.get(id);
  if (!g) return '?';
  return getLanguage() === 'en' ? g.name.en : g.name.ko;
}

export function itemName(id: string): string {
  const def = itemRegistry.get(id);
  return def ? t(def.nameKey) : t('adv.unknown');
}

/** Resolve ids in params into display text. Comma-separated key lists become name lists. */
export function socialParams(
  sim: ClientSim,
  params: Readonly<Record<string, string | number>> | undefined,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (typeof v !== 'string') out[k] = v;
    else if (NAME_KEYS.has(k))
      out[k] = v
        .split(',')
        .map((x) => nameOf(sim, x))
        .join(t('news.and'));
    else if (k === 'item') out[k] = itemName(v);
    else if (k === 'monster') out[k] = t(`monster.${v}`);
    else if (k === 'job') out[k] = t(`job.${v}`);
    else if (k === 'guild') out[k] = guildName(sim, v);
    else out[k] = v;
  }
  return out;
}

/** Text of a conversation line in a speaker's voice (tone first, then register). */
export function lineText(
  tone: Tone,
  line: string,
  params: Record<string, string | number>,
): string {
  const toned = `talk.${tone}.${line}`;
  const text = t(toned, params);
  if (text !== toned) return text;
  return t(`talk.${registerOf(tone)}.${line}`, params);
}

/** A line spoken by an adventurer (key) with params resolved. */
export function spokenText(
  sim: ClientSim,
  speaker: string,
  line: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const a = sim.adventurers.byKey(speaker);
  const tone: Tone = a ? toneOf(a.profile.personality) : 'calm';
  return lineText(tone, line, socialParams(sim, params));
}

export function relationText(label: RelationLabel): string {
  return t(`rel.${label}`);
}

export function playerRelation(sim: ClientSim, key: string): RelationLabel {
  return relationLabel(sim.adventurers.byKey(key)?.memory.relations.get(sim.selfKey));
}
