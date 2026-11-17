import { Controller, Get, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { type OrgsPage, OrgsPage as OrgsPageSchema, OrgsQuery } from "@open-macaron/contracts";
import type { Request } from "express";
import { SessionsService } from "../accounts/sessions.service.ts";
import { OrgsService } from "../publish/orgs.service.ts";

/**
 * What the bot works on, the same for every signed-in user: capabilities are per user, never per
 * repository. Reached only by the web app (the edge never routes /v1/orgs).
 */
@ApiTags("orgs")
@ApiCookieAuth()
@Controller("v1/orgs")
export class OrgsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly orgs: OrgsService,
  ) {}

  @Get()
  @ApiOperation({ operationId: "listOrgs", summary: "A page of the configured orgs' repositories, each with its fork once it is ready" })
  @ApiResponse({ status: 200, standardSchema: OrgsPageSchema })
  @ApiResponse({ status: 401, description: "No valid session" })
  async list(@Req() request: Request, @Query({ schema: OrgsQuery }) query: OrgsQuery): Promise<OrgsPage> {
    await this.sessions.user(request.headers);
    return this.orgs.page(query.limit, query.after);
  }
}
