<script lang="ts">
  import { onboardingLinks } from "#lib/onboarding.js";

  const steps = [
    { title: "Check the upstream", text: "It must be public. Look at its contribution rules: a DCO, a CLA to sign once for macaron-bot, interaction limits." },
    { title: "Open a pull request to open-macaron/config", text: "Add the repository under repos: in orgs/<org>/org.yaml, with its build, test and lint commands. A new org folder (org.yaml, OWNERS.yaml) is merged by the platform team." },
    { title: "The org's owners approve", text: "Their approval merges it, and the repository shows as Ready on the Organisations page within minutes. An org with a fallback needs no entry: the bot takes a repository it doesn't list on its first request." },
  ];
</script>

<div class="grid gap-6">
  <p class="text-sm leading-relaxed">
    The bot only answers on repositories of <a class="underline underline-offset-4" href={onboardingLinks.config} target="_blank" rel="external noopener noreferrer">open-macaron/config</a>, grouped by GitHub organisation. Each organisation has owners, who approve its changes (<a class="underline underline-offset-4" href={onboardingLinks.configReadme} target="_blank" rel="external noopener noreferrer">how approvals work</a>).
  </p>
  <ol class="grid gap-3">
    {#each steps as step, position (step.title)}
      <li class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <span class="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">{position + 1}</span>
        <p class="text-sm font-medium">{step.title}</p>
        <p class="col-start-2 text-xs leading-relaxed text-muted-foreground">{step.text}</p>
      </li>
    {/each}
  </ol>
  <pre class="overflow-x-auto rounded-lg bg-muted p-4 text-xs"><code># orgs/my-org/org.yaml
repos:
  my-repo:
    commands:
      build: pnpm build
      test: pnpm test
      lint: pnpm lint</code></pre>
</div>
