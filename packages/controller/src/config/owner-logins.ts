import { Inject, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { describeError } from "../common/errors.ts";
import { GH_INTERACT, type GitHub } from "../github/github.ts";

/**
 * The current login of each configured owner, by account id: an org file names an owner by its id,
 * and the login it was written with may since have been renamed, or taken by someone else.
 */
export abstract class OwnerLogins {
  /** The logins it could find; an id missing from the result keeps its file's login. */
  abstract current(ids: readonly number[]): Promise<ReadonlyMap<number, string>>;
}

/** Trusts the files' logins: a local CONFIG_DIR and tests. */
export class FileLogins extends OwnerLogins {
  override current(): Promise<ReadonlyMap<number, string>> {
    return Promise.resolve(new Map());
  }
}

const Account = z.object({ id: z.int(), login: z.string() });

@Injectable()
export class GitHubOwnerLogins extends OwnerLogins {
  private readonly logger = new Logger(GitHubOwnerLogins.name);

  constructor(@Inject(GH_INTERACT) private readonly gh: GitHub) {
    super();
  }

  override async current(ids: readonly number[]): Promise<ReadonlyMap<number, string>> {
    const logins = new Map<number, string>();
    for (const id of ids) {
      try {
        // Organisations and users alike.
        const { data } = await this.gh.request("GET /user/{account_id}", { account_id: id });
        logins.set(id, Account.parse(data).login);
      } catch (error: unknown) {
        this.logger.warn(`account ${String(id)}: login unknown, keeping the configuration's: ${describeError(error)}`);
      }
    }
    return logins;
  }
}
