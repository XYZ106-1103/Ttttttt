import {
  type ActiveQuest,
  type Character,
  getQuestDef,
  type QuestDef,
  type QuestObjective,
  STORY_QUESTS,
} from '@world/shared';
import type { QuestObjectiveView, QuestsState, QuestView } from './stores';

function targetOf(o: QuestObjective): string {
  switch (o.kind) {
    case 'kill':
      return o.target;
    case 'collect':
    case 'craft':
      return o.item;
    case 'reach':
      return o.biome;
    case 'enhance':
      return '';
  }
}

function view(def: QuestDef, have: (o: QuestObjective, i: number) => number): QuestView {
  const objectives: QuestObjectiveView[] = def.objectives.map((o, i) => ({
    kind: o.kind,
    target: targetOf(o),
    have: have(o, i),
    need: o.count,
  }));
  return {
    id: def.id,
    kind: def.kind,
    objectives,
    complete: objectives.every((o) => o.have >= o.need),
  };
}

/** The player's quest log as the UI shows it. */
export function questState(
  c: Character,
  key: string,
  day: number,
  nearGiver: boolean,
): QuestsState {
  const log = c.quests;
  const active = log.active.flatMap((q: ActiveQuest) => {
    const def = getQuestDef(q.id);
    return def ? [view(def, (_o, i) => log.progressOf(q, i, c.inventory))] : [];
  });
  const available = log.available(key, c.level, day).map((d) => view(d, () => 0));
  return {
    active,
    available,
    doneStory: STORY_QUESTS.filter((q) => log.isDone(q.id)).length,
    nearGiver,
  };
}

/** Change key: republish only when something visible changed. */
export function questStamp(c: Character, day: number, near: boolean): string {
  return `${c.quests.version}:${c.inventory.version}:${c.level}:${day}:${near}`;
}
