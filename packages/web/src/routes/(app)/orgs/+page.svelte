<script lang="ts">
  import FolderGit2Icon from "@lucide/svelte/icons/folder-git-2";
  import { toast } from "svelte-sonner";
  import StatusBadge from "#lib/components/admin/status-badge.svelte";
  import TableSkeleton from "#lib/components/admin/table-skeleton.svelte";
  import PageHeader from "#lib/components/shell/page-header.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Empty from "#lib/components/ui/empty/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import * as Tooltip from "#lib/components/ui/tooltip/index.js";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import type { ListOrgsResponse } from "#lib/server/controller/generated/types.gen.js";
  import { getOrgs } from "./orgs.remote.ts";

  const PAGE = 25;
  // Pages after the first, appended by "Load more"; `next` is undefined until one was loaded.
  let more = $state.raw<ListOrgsResponse["rows"]>([]);
  let next = $state<string | null | undefined>(undefined);
  let loading = $state(false);

  async function loadMore(cursor: string): Promise<void> {
    loading = true;
    try {
      const page = await getOrgs({ after: cursor, limit: PAGE });
      more = [...more, ...page.rows];
      next = page.nextCursor;
    } catch {
      toast.error("More organisations could not be loaded", { description: "Try again in a moment." });
    } finally {
      loading = false;
    }
  }
</script>

<PageHeader title="Organisations" description="Where the bot works, and whether each repository finished onboarding." />

<svelte:boundary>
  {@const first = await getOrgs({ limit: PAGE })}
  {@const cursor = next === undefined ? first.nextCursor : next}
  <Card.Root class="py-0">
    {#if first.rows.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FolderGit2Icon /></Empty.Media>
          <Empty.Title>No organisation yet</Empty.Title>
          <Empty.Description>Organisations are added to open-macaron/config by pull request.</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head class="ps-6">Organisation</Table.Head>
            <Table.Head>Repository</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head class="pe-6">Fork</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each [...first.rows, ...more] as { org, repo, fork, fallback } (`${org}/${repo ?? ""}`)}
            <Table.Row>
              <Table.Cell class="ps-6 text-muted-foreground">{org}</Table.Cell>
              {#if repo === null}
                <Table.Cell class="pe-6 text-muted-foreground" colspan={3}>No repository yet</Table.Cell>
              {:else}
                <Table.Cell>
                  <a class="font-medium hover:underline" href="https://github.com/{repo}" target="_blank" rel="noopener noreferrer">{repo}</a>
                  {#if fallback}
                    <Tooltip.Root>
                      <Tooltip.Trigger><Badge variant="secondary" class="ms-2">Fallback</Badge></Tooltip.Trigger>
                      <Tooltip.Content>Not listed by its organisation: its fallback settings apply, and its fork was made on its first request.</Tooltip.Content>
                    </Tooltip.Root>
                  {/if}
                </Table.Cell>
                <Table.Cell>
                  {#if fork !== null}
                    <StatusBadge tone="success" label="Ready" />
                  {:else}
                    <!-- "Not ready", never "in progress": a failed onboarding looks the same from here. -->
                    <Tooltip.Root>
                      <Tooltip.Trigger><StatusBadge tone="inactive" label="Not ready" /></Tooltip.Trigger>
                      <Tooltip.Content>The bot refuses requests here until its fork is ready. If this lasts, onboarding failed: see the comment on the config pull request, or the answer to the request.</Tooltip.Content>
                    </Tooltip.Root>
                  {/if}
                </Table.Cell>
                <Table.Cell class="pe-6">
                  {#if fork !== null}<a class="font-medium hover:underline" href="https://github.com/{fork}" target="_blank" rel="noopener noreferrer">{fork}</a>{/if}
                </Table.Cell>
              {/if}
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
      {#if cursor !== null}
        <div class="flex justify-center border-t p-4">
          <Button variant="outline" disabled={loading} onclick={() => loadMore(cursor)}>
            {#if loading}<Spinner />{/if}
            Load more
          </Button>
        </div>
      {/if}
    {/if}
  </Card.Root>
  {#snippet pending()}
    <Card.Root class="py-0"><TableSkeleton rows={8} /></Card.Root>
  {/snippet}
  {#snippet failed(error, reset)}
    <Empty.Root>
      <Empty.Header>
        <Empty.Title>The organisations could not be loaded</Empty.Title>
        <Empty.Description>{error instanceof Error ? error.message : "Try again in a moment."}</Empty.Description>
      </Empty.Header>
      <Empty.Content><Button variant="outline" onclick={reset}>Try again</Button></Empty.Content>
    </Empty.Root>
  {/snippet}
</svelte:boundary>
