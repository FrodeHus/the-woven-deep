import type Database from 'better-sqlite3';

export interface ProfileRow {
  id: string;
  normalizedEmail: string;
  progressionJson: string;
  settingsJson: string | null;
  settingsVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface ProfileTableRow {
  id: string;
  normalized_email: string;
  progression_json: string;
  settings_json: string | null;
  settings_version: number;
  created_at: string;
  updated_at: string;
}

function toRow(row: ProfileTableRow): ProfileRow {
  return {
    id: row.id,
    normalizedEmail: row.normalized_email,
    progressionJson: row.progression_json,
    settingsJson: row.settings_json,
    settingsVersion: row.settings_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProfileRepository {
  private readonly findByEmailStatement;
  private readonly findByIdStatement;
  private readonly insertStatement;
  private readonly updateSettingsStatement;

  constructor(private readonly database: Database.Database) {
    this.findByEmailStatement = this.database.prepare(
      'select * from profiles where normalized_email = ?',
    );
    this.findByIdStatement = this.database.prepare('select * from profiles where id = ?');
    this.insertStatement = this.database.prepare(`
      insert into profiles(id, normalized_email, progression_json, settings_json, settings_version, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `);
    this.updateSettingsStatement = this.database.prepare(`
      update profiles set settings_json = ?, settings_version = ?, updated_at = ? where id = ?
    `);
  }

  findByEmail(normalizedEmail: string): ProfileRow | undefined {
    const row = this.findByEmailStatement.get(normalizedEmail) as ProfileTableRow | undefined;
    return row ? toRow(row) : undefined;
  }

  findById(id: string): ProfileRow | undefined {
    const row = this.findByIdStatement.get(id) as ProfileTableRow | undefined;
    return row ? toRow(row) : undefined;
  }

  create(input: { id: string; normalizedEmail: string; nowIso: string }): ProfileRow {
    this.insertStatement.run(
      input.id,
      input.normalizedEmail,
      '{}',
      null,
      0,
      input.nowIso,
      input.nowIso,
    );

    return {
      id: input.id,
      normalizedEmail: input.normalizedEmail,
      progressionJson: '{}',
      settingsJson: null,
      settingsVersion: 0,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
    };
  }

  updateSettings(input: {
    id: string;
    settingsJson: string;
    settingsVersion: number;
    nowIso: string;
  }): void {
    this.updateSettingsStatement.run(
      input.settingsJson,
      input.settingsVersion,
      input.nowIso,
      input.id,
    );
  }
}
