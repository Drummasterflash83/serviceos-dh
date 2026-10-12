import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { databaseBackupTemplate, databaseBackupBinding as b } from "./database-backup-template.mjs";

test("reviewed artifact matches generator and cannot create keys, schedules or source access", () => {
  const template = databaseBackupTemplate();
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        new URL(
          "../../infrastructure/database-backup/foundation.cloudformation.json",
          import.meta.url,
        ),
      ),
    ),
    template,
  );
  assert.deepEqual(
    Object.values(template.Resources)
      .map((r) => r.Type)
      .sort(),
    [
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
      "AWS::IAM::ManagedPolicy",
      "AWS::IAM::ManagedPolicy",
      "AWS::IAM::User",
      "AWS::IAM::User",
    ].sort(),
  );
  for (const name of ["Writer", "Restore"]) {
    const user = template.Resources[name].Properties;
    assert.equal(user.LoginProfile, undefined);
    assert.deepEqual(user.ManagedPolicyArns, [user.PermissionsBoundary]);
    assert.equal(user.Policies, undefined);
    assert.equal(user.Groups, undefined);
  }
});

test("each allowed action is bounded to the one project and restore cannot write", () => {
  const arn = `arn:aws:s3:::${b.bucket}`;
  for (const name of ["Writer", "Restore"]) {
    const statements =
      databaseBackupTemplate().Resources[`${name}Policy`].Properties.PolicyDocument.Statement;
    for (const statement of statements.filter((s) => s.Effect === "Allow")) {
      assert.ok([arn, `${arn}/${b.prefix}*`].includes(statement.Resource));
      for (const action of statement.Action) {
        assert.match(action, /^s3:(Get|List|PutObject$)/);
        assert.ok(!action.includes("*"));
        if (
          action.includes("Object") &&
          !action.includes("Configuration") &&
          !action.includes("Ownership")
        )
          assert.equal(statement.Resource, `${arn}/${b.prefix}*`);
        if (action.startsWith("s3:List"))
          assert.deepEqual(statement.Condition, { StringLike: { "s3:prefix": `${b.prefix}*` } });
        if (name === "Restore") assert.ok(!action.startsWith("s3:Put"));
      }
    }
    const denies = statements.filter((s) => s.Effect === "Deny").flatMap((s) => s.Action);
    assert.ok(denies.includes("s3:Delete*"));
    assert.ok(denies.includes("s3:BypassGovernanceRetention"));
  }
});

test("destination is pinned and retained without automatic expiry or public access", () => {
  const t = databaseBackupTemplate();
  assert.deepEqual(
    t.Rules.Destination.Assertions.map((a) => a.Assert["Fn::Equals"]),
    [
      [{ Ref: "AWS::AccountId" }, b.accountId],
      [{ Ref: "AWS::Region" }, b.region],
    ],
  );
  const bucket = t.Resources.Database;
  assert.equal(bucket.DeletionPolicy, "Retain");
  assert.equal(bucket.UpdateReplacePolicy, "Retain");
  assert.equal(bucket.Properties.LifecycleConfiguration, undefined);
  assert.ok(
    Object.values(bucket.Properties.PublicAccessBlockConfiguration).every((v) => v === true),
  );
  assert.deepEqual(bucket.Properties.ObjectLockConfiguration.Rule.DefaultRetention, {
    Mode: "GOVERNANCE",
    Days: 30,
  });
  assert.equal(bucket.Properties.VersioningConfiguration.Status, "Enabled");
  const statements = t.Resources.DatabasePolicy.Properties.PolicyDocument.Statement;
  assert.ok(statements.every((s) => s.Effect === "Deny"));
  assert.ok(statements.some((s) => s.Condition.Bool?.["aws:SecureTransport"] === "false"));
  assert.ok(statements.some((s) => s.Condition.Null?.["s3:if-none-match"] === "true"));
  assert.ok(
    statements.some(
      (s) => s.Condition.StringNotEquals?.["s3:x-amz-server-side-encryption"] === "AES256",
    ),
  );
});
