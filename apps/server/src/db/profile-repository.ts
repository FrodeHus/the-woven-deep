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
  private readonly deleteProfileStatement;
  private readonly deleteHallRecordsStatement;
  private readonly deleteHallStateStatement;
  private readonly deleteActiveRunsStatement;
  private readonly deleteSessionsStatement;
  private readonly deleteLoginTokensStatement;
  private readonly deleteTransaction;

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
    // Every child row is deleted explicitly here rather than relying on `on delete cascade` --
    // `sessions`/`login_tokens`/`active_runs` have no cascade clause at all (see database.ts's
    // migrations), and even `hall_records`/`hall_state`'s cascade only fires when the
    // `foreign_keys` pragma is ON for the connection that runs the delete. Explicit deletes are
    // correct and idempotent regardless of that pragma's state or of which tables happen to
    // cascade, so `delete()` below never depends on it.
    this.deleteHallRecordsStatement = this.database.prepare(
      'delete from hall_records where profile_id = ?',
    );
    this.deleteHallStateStatement = this.database.prepare(
      'delete from hall_state where profile_id = ?',
    );
    this.deleteActiveRunsStatement = this.database.prepare(
      'delete from active_runs where profile_id = ?',
    );
    this.deleteSessionsStatement = this.database.prepare(
      'delete from sessions where profile_id = ?',
    );
    // `login_tokens` has no `profile_id` column (it's keyed by `normalized_email`, since a login
    // token is issued before a profile necessarily exists) -- `delete()` looks up the profile's
    // email first and deletes by that instead.
    this.deleteLoginTokensStatement = this.database.prepare(
      'delete from login_tokens where normalized_email = ?',
    );
    this.deleteProfileStatement = this.database.prepare('delete from profiles where id = ?');

    this.deleteTransaction = this.database.transaction((id: string, normalizedEmail: string) => {
      this.deleteHallRecordsStatement.run(id);
      this.deleteHallStateStatement.run(id);
      this.deleteActiveRunsStatement.run(id);
      this.deleteSessionsStatement.run(id);
      this.deleteLoginTokensStatement.run(normalizedEmail);
      this.deleteProfileStatement.run(id);
    });
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

  /**
   * Permanently deletes a profile and every row that belongs to it -- `hall_records`,
   * `hall_state`, `active_runs`, `sessions`, `login_tokens`, then the `profiles` row itself --
   * in a single transaction. A no-op if the profile is already gone (idempotent: safe to call
   * more than once for the same id). See the constructor's comment on why each child table is
   * deleted explicitly instead of relying on cascade.
   */
  delete(profileId: string): void {
    const profile = this.findById(profileId);
    if (!profile) return;
    this.deleteTransaction(profileId, profile.normalizedEmail);
  }
}
