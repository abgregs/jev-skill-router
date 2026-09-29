import type { Skill } from './types.js'
import { deriveKeywords } from './loadSkills.js'

// A realistic large-org internal skill catalog (Uber-style), generated procedurally.
//
// Real enterprise skill sprawl is NOT 1000 unique capabilities — it's ~a few dozen
// capabilities replicated across many services/teams. So we expand a seed taxonomy
// across a service list. This reaches 1000+ skills cheaply AND produces the genuinely
// confusable near-duplicates (deploy-payments vs deploy-maps) that make routing hard —
// the whole point of the >255 scale test.

/** Realistic service names for a large ride-hail / delivery org. */
const SERVICES = [
  'payments', 'maps', 'rider', 'driver', 'eats', 'freight', 'identity', 'pricing',
  'dispatch', 'notifications', 'wallet', 'promotions', 'search', 'matching', 'routing',
  'billing', 'fleet', 'safety', 'ratings', 'messaging', 'onboarding', 'support',
  'ledger', 'geo', 'gateway', 'checkout', 'inventory', 'catalog', 'recommendations',
  'fraud', 'kyc', 'invoicing', 'settlements', 'tolls', 'surge', 'incentives',
  'referrals', 'chat', 'telemetry', 'tracing', 'config', 'auth', 'sessions',
  'profiles', 'reviews', 'disputes', 'refunds', 'geofencing'
]

interface SeedSkill {
  base: string
  name: string
  domain: string
  /** One-line description; `{service}` is substituted per service when perService. */
  desc: string
  /** true = replicate across every service; false = a single org-wide skill. */
  perService: boolean
}

// ~22 per-service capabilities × ~48 services (~1056) + org-wide singles below.
// A few intentional near-duplicate traps live across the two groups (e.g. per-service
// `rollback-release` vs org-wide `rollback-migration`; `deploy-service` vs
// `promote-to-prod`; per-service `add-grpc-endpoint` vs org-wide `generate-protobuf`).
const SEEDS: SeedSkill[] = [
  // platform / infra
  { base: 'deploy-service', name: 'Deploy service', domain: 'infra', perService: true, desc: 'Deploy the {service} service to a target environment through the standard rollout pipeline. Use when shipping a new build of {service} to staging or production or cutting a release. For promoting an already-verified build between environments use promote-to-prod; to undo a bad release use rollback-release.' },
  { base: 'rollback-release', name: 'Roll back release', domain: 'infra', perService: true, desc: 'Roll the {service} service back to its previously released version. Use when a {service} deploy is causing errors, elevated latency, or a bad release and you need the last known-good version. For reverting a database schema change use rollback-migration, not this.' },
  { base: 'scale-service', name: 'Scale service', domain: 'infra', perService: true, desc: 'Adjust replica counts and autoscaling policy for the {service} service. Use when {service} is under- or over-provisioned, hitting capacity limits, or its min/max replicas need tuning. Not for rolling out code changes (use deploy-service).' },
  { base: 'rotate-secrets', name: 'Rotate secrets', domain: 'security', perService: true, desc: 'Rotate credentials, tokens, and API keys used by the {service} service. Use when a {service} secret may be leaked or expired, or on a scheduled rotation. For requesting new access use request-access-grant; for auditing permissions use review-iam-policy.' },
  { base: 'provision-kafka-topic', name: 'Provision Kafka topic', domain: 'infra', perService: true, desc: 'Create and configure a Kafka topic for the {service} service. Use when {service} needs a new event stream or message topic with partitions and retention set. For a relational datastore use provision-database instead.' },
  { base: 'provision-database', name: 'Provision database', domain: 'infra', perService: true, desc: 'Provision and configure a new database instance for the {service} service. Use when {service} needs a new datastore. For a Kafka event topic use provision-kafka-topic; to change schema on an existing DB use write-migration.' },
  // backend
  { base: 'add-grpc-endpoint', name: 'Add gRPC endpoint', domain: 'backend', perService: true, desc: 'Add a new gRPC endpoint to the {service} service and regenerate its stubs. Use when adding an RPC method or API surface to {service}. For regenerating protobuf/gRPC stubs across services from updated .proto files use generate-protobuf.' },
  { base: 'write-migration', name: 'Write schema migration', domain: 'backend', perService: true, desc: 'Author and apply a database schema migration for the {service} service. Use when {service} needs a schema change such as a new table, column, or index. To undo the most recent migration use rollback-migration; to stand up a new database use provision-database.' },
  { base: 'add-feature-flag', name: 'Add feature flag', domain: 'backend', perService: true, desc: 'Add a feature flag guarding new behavior in the {service} service. Use when rolling out {service} behavior gradually or behind a kill switch. For throttling request volume use add-rate-limiter instead.' },
  { base: 'add-rate-limiter', name: 'Add rate limiter', domain: 'backend', perService: true, desc: 'Add or tune a rate limiter on the {service} service endpoints. Use when {service} needs to throttle inbound traffic or protect a downstream from overload. To fail fast on a failing dependency use wire-circuit-breaker.' },
  { base: 'wire-circuit-breaker', name: 'Wire circuit breaker', domain: 'backend', perService: true, desc: 'Wrap a downstream dependency of the {service} service in a circuit breaker. Use when {service} calls a flaky dependency and should fail fast or shed load when it degrades. For limiting inbound request rate use add-rate-limiter.' },
  // observability
  { base: 'create-datadog-dashboard', name: 'Create Datadog dashboard', domain: 'observability', perService: true, desc: 'Build a Datadog dashboard of key metrics for the {service} service. Use when you need standing visibility into {service} latency, errors, or throughput. To page on threshold breaches use add-slo-alert; to chase a specific regression use trace-latency-regression.' },
  { base: 'add-slo-alert', name: 'Add SLO alert', domain: 'observability', perService: true, desc: 'Define an SLO and paging alert for the {service} service. Use when {service} needs an on-call alert on error budget or latency/error thresholds. For a metrics overview rather than alerting use create-datadog-dashboard.' },
  { base: 'trace-latency-regression', name: 'Trace latency regression', domain: 'observability', perService: true, desc: 'Investigate a latency regression in the {service} service using distributed traces. Use when {service} got slower and you need to find the offending span or dependency. For standing dashboards use create-datadog-dashboard; for alerting use add-slo-alert.' },
  // release engineering
  { base: 'run-integration-tests', name: 'Run integration tests', domain: 'release', perService: true, desc: 'Run the integration test suite for the {service} service. Use when validating {service} changes end-to-end before release. For comparing a canary build against baseline use run-canary-analysis.' },
  { base: 'run-canary-analysis', name: 'Run canary analysis', domain: 'release', perService: true, desc: 'Run canary analysis comparing a new {service} build against the current baseline. Use when a {service} release is in canary and you must decide promote vs roll back. For the full test suite use run-integration-tests; to promote use promote-to-prod.' },
  // security
  { base: 'run-security-scan', name: 'Run security scan', domain: 'security', perService: true, desc: 'Run dependency and container security scans for the {service} service. Use when checking {service} for vulnerable dependencies or CVEs before release. For reviewing IAM/access policy use review-iam-policy instead.' },
  { base: 'review-iam-policy', name: 'Review IAM policy', domain: 'security', perService: true, desc: 'Review and tighten IAM and access policies for the {service} service. Use when auditing who or what can access {service} resources. To rotate credentials use rotate-secrets; to request access use request-access-grant.' },
  { base: 'request-access-grant', name: 'Request access grant', domain: 'security', perService: true, desc: 'Request a scoped, time-bound access grant to the {service} service resources. Use when you need temporary access to {service}. To audit existing policy use review-iam-policy; to rotate secrets use rotate-secrets.' },
  // data / ml
  { base: 'backfill-table', name: 'Backfill table', domain: 'data', perService: true, desc: 'Run a backfill job over the {service} service data tables. Use when {service} data needs recomputing or populating for a historical range. To add a validation check to the pipeline use add-data-quality-check.' },
  { base: 'add-data-quality-check', name: 'Add data-quality check', domain: 'data', perService: true, desc: 'Add a data-quality check to the {service} service pipeline. Use when {service} data needs validation or anomaly detection in its pipeline. To recompute historical data use backfill-table.' },
  { base: 'update-runbook', name: 'Update runbook', domain: 'ops', perService: true, desc: 'Update the on-call runbook for the {service} service. Use when {service} operational procedures changed and the runbook needs revising. For writing a post-incident analysis use write-postmortem.' },

  // org-wide singles (not per service)
  { base: 'write-design-doc', name: 'Write design doc', domain: 'process', perService: false, desc: 'Draft an engineering design document or RFC for a new project or major change. Use when proposing a significant technical change that needs design review before building. For requesting review of already-written code use request-code-review.' },
  { base: 'open-incident', name: 'Open incident', domain: 'ops', perService: false, desc: 'Open and coordinate a production incident bridge and comms. Use when there is an active production outage or SEV that needs coordination. After it is resolved, write it up with write-postmortem.' },
  { base: 'write-postmortem', name: 'Write postmortem', domain: 'ops', perService: false, desc: 'Write a blameless postmortem after an incident is resolved. Use when an incident is over and needs a root-cause write-up and action items. To coordinate a live incident use open-incident; to update procedures use update-runbook.' },
  { base: 'request-code-review', name: 'Request code review', domain: 'process', perService: false, desc: 'Request and route a code review to the correct owning team. Use when your change needs review before merge. For design-level review before coding use write-design-doc.' },
  { base: 'onboard-engineer', name: 'Onboard engineer', domain: 'process', perService: false, desc: 'Set up a new engineer environment, access, and starter tasks. Use when a new engineer is joining and needs environment, access, and ramp-up. For time-bound access to one specific service use request-access-grant.' },
  { base: 'promote-to-prod', name: 'Promote to prod', domain: 'release', perService: false, desc: 'Promote an already-deployed and verified build from staging to production. Use when a build has passed canary or verification in a lower environment and only needs promotion. For a fresh build and deploy use deploy-service; to revert use rollback-release.' },
  { base: 'rollback-migration', name: 'Roll back migration', domain: 'backend', perService: false, desc: 'Roll back the most recent applied database schema migration. Use when a schema migration caused problems and must be reverted. To revert a service code release use rollback-release; to author a migration use write-migration.' },
  { base: 'generate-protobuf', name: 'Generate protobuf', domain: 'backend', perService: false, desc: 'Regenerate protobuf and gRPC stubs from updated .proto definitions. Use when .proto files changed and stubs must be regenerated across services. To add a new gRPC endpoint to one specific service use add-grpc-endpoint.' }
]

export interface SyntheticCatalogOptions {
  /** Override the service list (e.g. a smaller set for fast tests). */
  services?: string[]
}

/**
 * Build the synthetic org catalog. Deterministic: same inputs → same ids, so labeled
 * eval sessions can reference generated ids like `rollback-release-payments`.
 */
export function synthesizeCatalog(opts: SyntheticCatalogOptions = {}): Skill[] {
  const services = opts.services ?? SERVICES
  const skills: Skill[] = []

  const push = (id: string, name: string, description: string) => {
    skills.push({
      id,
      name,
      description,
      scope: 'synthetic',
      source: `synthetic:${id}`,
      keywords: deriveKeywords(name, description)
    })
  }

  for (const seed of SEEDS) {
    if (!seed.perService) {
      push(seed.base, seed.name, seed.desc)
      continue
    }
    for (const service of services) {
      push(
        `${seed.base}-${service}`,
        `${seed.name} — ${service}`,
        seed.desc.replaceAll('{service}', service)
      )
    }
  }

  return skills
}
