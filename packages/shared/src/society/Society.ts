/** Parties, guilds and world news, saved and restored together. */
import { GuildSystem } from './Guild';
import { NewsFeed } from './News';
import { PartySystem } from './Party';

export interface SocietyData {
  readonly parties: unknown;
  readonly guilds: unknown;
  readonly news: unknown;
}

export class Society {
  readonly parties = new PartySystem();
  readonly guilds = new GuildSystem();
  readonly news = new NewsFeed();

  toJSON(): SocietyData {
    return {
      parties: this.parties.toJSON(),
      guilds: this.guilds.toJSON(),
      news: this.news.toJSON(),
    };
  }

  load(data: unknown, validKey: (key: string) => boolean): void {
    const d = data as Partial<SocietyData> | null;
    if (!d || typeof d !== 'object') return;
    this.parties.load(d.parties, validKey);
    this.guilds.load(d.guilds, validKey);
    this.news.load(d.news);
  }
}
