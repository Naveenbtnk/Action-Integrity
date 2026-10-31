import 'dotenv/config';

import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { hash } from 'bcryptjs';

import type { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';

const base = 'http://localhost:3000';
const testId = randomUUID().replaceAll('-', '');
const identities = {
  reviewer: `e2e-reviewer-${testId}@aic.local`,
  reviewer2: `e2e-reviewer2-${testId}@aic.local`,
  senior: `e2e-senior-${testId}@aic.local`,
  viewer: `e2e-viewer-${testId}@aic.local`,
  admin: `e2e-admin-${testId}@aic.local`,
};
const identityRoles: Record<keyof typeof identities, Role> = {
  reviewer: 'REVIEWER',
  reviewer2: 'REVIEWER',
  senior: 'SENIOR_REVIEWER',
  viewer: 'VIEWER',
  admin: 'ADMIN',
};
const passwords = new Map<string, string>();
let caseRef = '';
let quorumRef = '';
let unknownRef = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (process.env.AUTH_CREDENTIALS_ENABLED !== 'true')
    throw new Error('Local e2e requires AUTH_CREDENTIALS_ENABLED=true.');
  for (const [name, email] of Object.entries(identities) as Array<
    [keyof typeof identities, string]
  >) {
    const password = randomBytes(24).toString('base64url');
    passwords.set(email, password);
    await db.user.create({
      data: {
        email,
        name: `E2E ${name}`,
        roles: [identityRoles[name]],
        passwordHash: await hash(password, 12),
      },
    });
  }
  const event = await db.integrityEvent.findFirstOrThrow();
  const policy = await db.policyVersion.findFirstOrThrow({ where: { status: 'ACTIVE' } });
  const target = await db.tgtEntitlement.findFirstOrThrow({
    where: { entitlementKey: 'SSO', status: 'ACTIVE' },
  });
  const suffix = randomUUID();
  caseRef = `UI-${suffix}`;
  const now = new Date();
  const fixture = await db.case.create({
    data: {
      ref: caseRef,
      integrityEventId: event.id,
      title: 'Browser two-person block fixture',
      status: 'AWAITING_APPROVAL',
      severity: 'MEDIUM',
      riskScore: 40,
      riskBand: 'MEDIUM',
      exposureCount: 1,
      estimatedValueMinor: 1000n,
      mode: 'DETERMINISTIC',
      openedAt: now,
      lastTransitionAt: now,
    },
  });
  const action = await db.outboundAction.create({
    data: {
      ref: `UI-ACT-${suffix}`,
      sourceAgent: 'e2e-fixture',
      accountId: target.accountId,
      actionType: 'ENTITLEMENT_REVOKE',
      payload: { entitlementKey: 'SSO', from: 'ACTIVE', to: 'REMOVED' },
      payloadHash: `e2e-${suffix}`,
      requestedAt: now,
      status: 'HELD',
      gateDecision: 'HOLD',
      gateEvaluatedAt: now,
      idempotencyKey: `e2e-${suffix}`,
      caseId: fixture.id,
      integrityEventId: event.id,
    },
  });
  await db.actionHold.create({
    data: { outboundActionId: action.id, caseId: fixture.id, reason: 'E2E fixture', placedAt: now },
  });
  const evidenceHash = `e2e-evidence-${suffix}`;
  const report = await db.investigationReport.create({
    data: {
      caseId: fixture.id,
      runId: `e2e-${suffix}`,
      mode: 'DETERMINISTIC',
      recommendedDisposition: 'BLOCK',
      confidence: '1.00',
      evidenceCompleteness: '1.00',
      reasoning: 'The synthetic entitlement must remain active.',
      missingEvidence: [],
      citations: [],
      promptVersion: 'e2e',
      evidenceHash,
      isFallback: true,
      createdAt: now,
    },
  });
  await db.policyDecision.create({
    data: {
      caseId: fixture.id,
      reportId: report.id,
      riskScore: 40,
      riskBand: 'MEDIUM',
      disposition: 'BLOCK',
      allowedDispositions: ['BLOCK'],
      approvalRequired: true,
      requiredApprovals: 1,
      requiredRoles: ['REVIEWER'],
      reasons: [],
      policyVersion: policy.version,
      policyHash: policy.hash,
      evidenceHash,
      inputsHash: `e2e-inputs-${suffix}`,
      isFallback: false,
      createdAt: now,
    },
  });
  quorumRef = `UI-Q-${suffix}`;
  const quorumCase = await db.case.create({
    data: {
      ref: quorumRef,
      integrityEventId: event.id,
      title: 'Browser quorum fixture',
      status: 'AWAITING_APPROVAL',
      severity: 'HIGH',
      riskScore: 82,
      riskBand: 'HIGH',
      exposureCount: 480,
      estimatedValueMinor: 100_000n,
      mode: 'DETERMINISTIC',
      openedAt: now,
      lastTransitionAt: now,
    },
  });
  const quorumAction = await db.outboundAction.create({
    data: {
      ref: `UI-Q-ACT-${suffix}`,
      sourceAgent: 'e2e-fixture',
      accountId: target.accountId,
      actionType: 'ENTITLEMENT_REVOKE',
      payload: { entitlementKey: 'SSO', from: 'ACTIVE', to: 'REMOVED' },
      payloadHash: `e2e-q-${suffix}`,
      requestedAt: now,
      status: 'HELD',
      gateDecision: 'HOLD',
      gateEvaluatedAt: now,
      idempotencyKey: `e2e-q-${suffix}`,
      caseId: quorumCase.id,
      integrityEventId: event.id,
    },
  });
  await db.actionHold.create({
    data: {
      outboundActionId: quorumAction.id,
      caseId: quorumCase.id,
      reason: 'E2E quorum fixture',
      placedAt: now,
    },
  });
  const quorumEvidence = `e2e-quorum-evidence-${suffix}`;
  const quorumReport = await db.investigationReport.create({
    data: {
      caseId: quorumCase.id,
      runId: `e2e-quorum-${suffix}`,
      mode: 'DETERMINISTIC',
      recommendedDisposition: 'RELEASE_AFTER_CORRECTION',
      confidence: '1.00',
      evidenceCompleteness: '1.00',
      reasoning: 'High-risk synthetic release requires a senior reviewer.',
      missingEvidence: [],
      citations: [],
      promptVersion: 'e2e',
      evidenceHash: quorumEvidence,
      isFallback: true,
      createdAt: now,
    },
  });
  await db.policyDecision.create({
    data: {
      caseId: quorumCase.id,
      reportId: quorumReport.id,
      riskScore: 82,
      riskBand: 'HIGH',
      disposition: 'RELEASE_AFTER_CORRECTION',
      allowedDispositions: ['RELEASE_AFTER_CORRECTION'],
      approvalRequired: true,
      requiredApprovals: 2,
      requiredRoles: ['SENIOR_REVIEWER'],
      reasons: [],
      policyVersion: policy.version,
      policyHash: policy.hash,
      evidenceHash: quorumEvidence,
      inputsHash: `e2e-q-inputs-${suffix}`,
      isFallback: false,
      createdAt: now,
    },
  });
  unknownRef = `UI-U-${suffix}`;
  const unknownCase = await db.case.create({
    data: {
      ref: unknownRef,
      integrityEventId: event.id,
      title: 'Browser unknown-outcome fixture',
      status: 'VERIFYING',
      severity: 'HIGH',
      riskScore: 76,
      riskBand: 'HIGH',
      exposureCount: 1,
      estimatedValueMinor: 1000n,
      mode: 'DETERMINISTIC',
      openedAt: now,
      lastTransitionAt: now,
    },
  });
  await db.actionExecution.create({
    data: {
      caseId: unknownCase.id,
      reopenCount: 0,
      kind: 'RELEASE',
      targetObjectType: 'ENTITLEMENT',
      targetObjectRef: target.accountId,
      idempotencyKey: `e2e-unknown-${suffix}`,
      status: 'UNKNOWN',
      requestPayload: {},
      startedAt: now,
    },
  });
});

test.afterAll(async () => {
  await db.user.updateMany({
    where: { email: { in: Object.values(identities) } },
    data: { passwordHash: null, isActive: false, sessionEpoch: { increment: 1 } },
  });
  await db.$disconnect();
});

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto(`${base}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwords.get(email) ?? '');
  await page.getByRole('button', { name: 'Sign in locally' }).click();
  await expect(page).toHaveURL(/\/app\/overview/, { timeout: 60_000 });
}

test('case snapshot downloads recorded facts without claiming audit proof', async ({ page }) => {
  await login(page, identities.viewer);
  await page.goto(`${base}/app/investigations/${caseRef}`);
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toBe(`case-${caseRef}.json`);
  const jsonPath = await jsonDownload.path();
  if (!jsonPath) throw new Error('JSON download path is missing.');
  const record = JSON.parse(await readFile(jsonPath, 'utf8')) as {
    proofStatus: string;
    case: { ref: string; status: string };
    policy: { version: string };
    verification: unknown;
  };
  expect(record.proofStatus).toBe('UNSIGNED_SNAPSHOT');
  expect(record.case.ref).toBe(caseRef);
  expect(record.policy.version).toBe('2026.10.2');
  expect(record.verification).toBeNull();

  const markdownDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Markdown' }).click();
  const markdownDownload = await markdownDownloadPromise;
  const markdownPath = await markdownDownload.path();
  if (!markdownPath) throw new Error('Markdown download path is missing.');
  const markdown = await readFile(markdownPath, 'utf8');
  expect(markdown).toContain('Unsigned operator snapshot');
  expect(markdown).toContain('Verification: not recorded');
});

test('multipage navigation keeps each workflow distinct at desktop and compact widths', async ({
  page,
}) => {
  await login(page, identities.viewer);
  const destinations = [
    ['Overview', '/app/overview', 'Operational overview'],
    ['Actions', '/app/actions', 'Action queue'],
    ['Investigations', '/app/investigations', 'Investigations'],
    ['Recoveries', '/app/recoveries', 'Recoveries'],
    ['Verification', '/app/verification', 'Verification'],
    ['Policies', '/app/policies', 'Policies'],
    ['Audit', '/app/audit', 'Audit record'],
    ['Settings', '/app/settings', 'Settings'],
  ] as const;
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [label, path, heading] of destinations) {
      await page.goto(`${base}${path}`);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(
        page
          .getByRole('navigation', { name: 'Primary' })
          .getByRole('link', { name: label, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(width);
    }
  }
});

test('action table offers compact density, column controls, and keyboard row navigation', async ({
  page,
}) => {
  await login(page, identities.viewer);
  await page.goto(`${base}/app/actions`);
  await page.getByRole('link', { name: 'Oldest' }).click();
  await expect(page).toHaveURL(/sort=oldest/);
  await page.getByRole('link', { name: 'Newest' }).click();
  await expect(page).not.toHaveURL(/sort=oldest/);
  await page.getByRole('button', { name: 'Compact rows' }).click();
  await expect(page.getByRole('button', { name: 'Comfortable rows' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByText('Columns', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Account' }).uncheck();
  await expect(page.getByRole('columnheader', { name: 'Account' })).toHaveCount(0);
  const first = page.locator('tbody tr').first();
  const second = page.locator('tbody tr').nth(1);
  await first.focus();
  await first.press('ArrowDown');
  await expect(second).toBeFocused();
  await second.press('Enter');
  await expect(page).toHaveURL(/\/app\/actions\/[^/]+/);
});

test('investigation views keep owner and evidence context on the server', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, identities.viewer);
  await page.goto(`${base}/app/investigations`);
  await expect(page.getByRole('heading', { name: 'Investigations' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Hypotheses' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Owner' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'SLA' })).toBeVisible();
  await page.getByRole('link', { name: 'Evidence needed' }).click();
  await expect(page).toHaveURL(/view=evidence/);
  await page.getByRole('link', { name: 'Assigned to me' }).click();
  await expect(page).toHaveURL(/view=owner/);
  await expect(page.getByText('No cases match this view.')).toBeVisible();
  await page.getByRole('link', { name: 'Active' }).click();
  await expect(page).not.toHaveURL(/view=/);
});

test('action detail shows linked case recommendation and policy boundary', async ({ page }) => {
  const action = await db.outboundAction.findFirstOrThrow({
    where: { case: { ref: quorumRef } },
    select: { id: true },
  });
  await login(page, identities.viewer);
  await page.goto(`${base}/app/actions/${action.id}`);
  await expect(page.getByRole('heading', { name: 'Gate decision' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evidence and conflicts' })).toBeVisible();
  await expect(page.getByText('AGENT RECOMMENDATION')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Policy boundary' })).toBeVisible();
});

test('case-loop and sod: reviewer approves, another reviewer blocks, then verifies', async ({
  browser,
}) => {
  const reviewer = await browser.newContext();
  const reviewerPage = await reviewer.newPage();
  await login(reviewerPage, identities.reviewer);
  await reviewerPage.goto(`${base}/app/investigations/${caseRef}`);
  await expect(reviewerPage.getByText('0 of 1 approvals')).toBeVisible();
  await reviewerPage
    .getByLabel('Rationale for BLOCK')
    .fill('The held revoke must be blocked after reviewing the evidence.');
  await reviewerPage.getByRole('button', { name: 'Record approval' }).click();
  await expect(
    reviewerPage.getByText('You approved this case. Another reviewer must complete this step.'),
  ).toBeVisible({ timeout: 60_000 });
  await expect(reviewerPage.getByRole('button', { name: 'Complete block' })).toHaveCount(0);

  const executor = await browser.newContext();
  const executorPage = await executor.newPage();
  await login(executorPage, identities.reviewer2);
  await executorPage.goto(`${base}/app/investigations/${caseRef}`);
  await expect(executorPage.getByText('1 of 1 approvals')).toBeVisible();
  await executorPage.getByRole('button', { name: 'Complete block' }).click();
  await expect(executorPage.getByRole('heading', { name: 'Verify business state' })).toBeVisible({
    timeout: 60_000,
  });
  await executorPage.getByRole('button', { name: 'Run verification' }).click();
  await expect(executorPage.getByText('Business state verified.')).toBeVisible({ timeout: 60_000 });
  await expect(executorPage.getByText('Closed · verified').first()).toBeVisible({
    timeout: 60_000,
  });
  await reviewer.close();
  await executor.close();
});

test('roles: viewer and admin have no business mutation controls', async ({ browser }) => {
  for (const email of [identities.viewer, identities.admin]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email);
    await page.goto(`${base}/app/investigations/${caseRef}`);
    await expect(page.getByRole('button', { name: 'Record approval' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Complete block' })).toHaveCount(0);
    if (email === identities.admin)
      await expect(
        page.getByText('Platform administrators do not decide business actions.'),
      ).toBeVisible();
    await context.close();
  }
});

test('quorum: one reviewer is insufficient until an independent senior approves', async ({
  browser,
}) => {
  const reviewer = await browser.newContext();
  const page = await reviewer.newPage();
  await login(page, identities.reviewer);
  await page.goto(`${base}/app/investigations/${quorumRef}`);
  await expect(page.getByText('0 of 2 approvals')).toBeVisible();
  await page
    .getByLabel('Rationale for RELEASE_AFTER_CORRECTION')
    .fill('Evidence supports the corrected synthetic release under current policy.');
  await page.getByRole('button', { name: 'Record approval' }).click();
  await expect(page.getByText('1 of 2 approvals')).toBeVisible();
  await expect(page.getByText('Missing SENIOR_REVIEWER')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Execute once' })).toHaveCount(0);
  const senior = await browser.newContext();
  const seniorPage = await senior.newPage();
  await login(seniorPage, identities.senior);
  await seniorPage.goto(`${base}/app/investigations/${quorumRef}`);
  await seniorPage
    .getByLabel('Rationale for RELEASE_AFTER_CORRECTION')
    .fill('I independently reviewed the evidence and approve this high-risk release.');
  await seniorPage.getByRole('button', { name: 'Record approval' }).click();
  await expect(seniorPage.getByText('2 of 2 approvals')).toBeVisible();
  const executor = await browser.newContext();
  const executorPage = await executor.newPage();
  await login(executorPage, identities.reviewer2);
  await executorPage.goto(`${base}/app/investigations/${quorumRef}`);
  await expect(executorPage.getByRole('button', { name: 'Execute once' })).toBeDisabled();
  await executorPage
    .getByLabel(`Type ${quorumRef} to confirm this high-risk action`)
    .fill(quorumRef);
  await expect(executorPage.getByRole('button', { name: 'Execute once' })).toBeEnabled();
  await reviewer.close();
  await senior.close();
  await executor.close();
});

test('unknown outcome stays amber and offers verification without re-execution', async ({
  page,
}) => {
  await login(page, identities.reviewer);
  await page.goto(`${base}/app/investigations/${unknownRef}`);
  await expect(page.getByText('Outcome unconfirmed — do not re-run.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run verification' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Execute once' })).toHaveCount(0);
});
