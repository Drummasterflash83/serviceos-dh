/** Local proposal generator only. Never contacts AWS or creates credentials. */
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const databaseBackupBinding = Object.freeze({
  accountId: "235099643372",
  region: "eu-west-2",
  project: "tgbnakbxwcqjeimygroz",
  bucket: "openfolk-serviceos-database-235099643372-eu-west-2",
  prefix: "projects/tgbnakbxwcqjeimygroz/",
});
// Bounded room for current whole-project growth; S3 uses a single PUT (<5 GiB).
export const MAX_DATABASE_PACKAGE_BYTES = 2 * 1024 ** 3;
const b = databaseBackupBinding;
const ref = (name) => ({ Ref: name });
const arn = `arn:aws:s3:::${b.bucket}`;
const objects = `${arn}/${b.prefix}*`;
const tags = [
  { Key: "OpenFolkPurpose", Value: "database-backup" },
  { Key: "SourceProject", Value: b.project },
];
const inspection = [
  "s3:GetBucketLocation",
  "s3:GetBucketVersioning",
  "s3:GetEncryptionConfiguration",
  "s3:GetBucketObjectLockConfiguration",
  "s3:GetBucketPublicAccessBlock",
  "s3:GetBucketPolicy",
  "s3:GetBucketOwnershipControls",
];
const reads = ["s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectRetention"];
const doc = (Statement) => ({ Version: "2012-10-17", Statement });

export function databaseBackupTemplate() {
  const policy = (writer) => ({
    Type: "AWS::IAM::ManagedPolicy",
    Properties: {
      Description: writer
        ? "Create and verify encrypted project snapshots; no deletion or retention bypass."
        : "Read encrypted project snapshots only; no writes or retention bypass.",
      PolicyDocument: doc([
        { Effect: "Allow", Action: inspection, Resource: arn },
        {
          Effect: "Allow",
          Action: ["s3:ListBucket", "s3:ListBucketVersions"],
          Resource: arn,
          Condition: { StringLike: { "s3:prefix": `${b.prefix}*` } },
        },
        { Effect: "Allow", Action: writer ? [...reads, "s3:PutObject"] : reads, Resource: objects },
        {
          Effect: "Deny",
          Action: writer
            ? [
                "s3:Delete*",
                "s3:BypassGovernanceRetention",
                "s3:PutObjectRetention",
                "s3:PutObjectLegalHold",
                "s3:PutBucket*",
                "s3:PutEncryptionConfiguration",
                "s3:PutLifecycleConfiguration",
              ]
            : ["s3:Put*", "s3:Delete*", "s3:BypassGovernanceRetention", "s3:RestoreObject"],
          Resource: [arn, `${arn}/*`],
        },
      ]),
    },
  });
  const identity = (name) => ({
    Type: "AWS::IAM::User",
    Properties: {
      Path: "/serviceos/database-backup/",
      ManagedPolicyArns: [ref(`${name}Policy`)],
      PermissionsBoundary: ref(`${name}Policy`),
      Tags: [...tags, { Key: "AccessPurpose", Value: name.toLowerCase() }],
    },
  });
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "PROPOSAL: OpenFolk London encrypted database backup and two scoped machine users. No keys, scheduler, source grants or data transfer.",
    Metadata: {
      Scope: "Whole production project, not a tenant-filtered export. Operator-only recovery.",
      ClientEncryption:
        "Runner must use age public-recipient encryption before upload; S3 cannot validate this.",
      Retention:
        "30-day governance lock; no automatic deletion. Privileged administrators may bypass governance.",
      Activation: "Requires owner approval before deploying this stack or creating machine keys.",
    },
    Rules: {
      Destination: {
        Assertions: [
          {
            Assert: { "Fn::Equals": [ref("AWS::AccountId"), b.accountId] },
            AssertDescription: "Verified OpenFolk account only.",
          },
          {
            Assert: { "Fn::Equals": [ref("AWS::Region"), b.region] },
            AssertDescription: "London only.",
          },
        ],
      },
    },
    Resources: {
      Database: {
        Type: "AWS::S3::Bucket",
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
        Properties: {
          BucketName: b.bucket,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
          OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
          BucketEncryption: {
            ServerSideEncryptionConfiguration: [
              { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
            ],
          },
          VersioningConfiguration: { Status: "Enabled" },
          ObjectLockEnabled: true,
          ObjectLockConfiguration: {
            ObjectLockEnabled: "Enabled",
            Rule: { DefaultRetention: { Mode: "GOVERNANCE", Days: 30 } },
          },
          Tags: tags,
        },
      },
      DatabasePolicy: {
        Type: "AWS::S3::BucketPolicy",
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
        Properties: {
          Bucket: ref("Database"),
          PolicyDocument: doc([
            {
              Sid: "RequireTLS",
              Effect: "Deny",
              Principal: "*",
              Action: "s3:*",
              Resource: [arn, `${arn}/*`],
              Condition: { Bool: { "aws:SecureTransport": "false" } },
            },
            {
              Sid: "RequireSSES3OnWrites",
              Effect: "Deny",
              Principal: "*",
              Action: "s3:PutObject",
              Resource: `${arn}/*`,
              Condition: { StringNotEquals: { "s3:x-amz-server-side-encryption": "AES256" } },
            },
            {
              Sid: "RequireCreateOnlyWrites",
              Effect: "Deny",
              Principal: "*",
              Action: "s3:PutObject",
              Resource: `${arn}/*`,
              Condition: {
                Null: { "s3:if-none-match": "true" },
                Bool: { "s3:ObjectCreationOperation": "true" },
              },
            },
          ]),
        },
      },
      WriterPolicy: policy(true),
      RestorePolicy: policy(false),
      Writer: identity("Writer"),
      Restore: identity("Restore"),
    },
    Outputs: {
      BucketName: { Value: ref("Database") },
      ProjectPrefix: { Value: b.prefix },
      WriterUserName: { Value: ref("Writer") },
      RestoreUserName: { Value: ref("Restore") },
      WriterUserArn: { Value: { "Fn::GetAtt": ["Writer", "Arn"] } },
      RestoreUserArn: { Value: { "Fn::GetAtt": ["Restore", "Arn"] } },
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(" ") !== "--write-template")
    throw Error("Use --write-template; never deploys.");
  const directory = new URL("../../infrastructure/database-backup/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    new URL("foundation.cloudformation.json", directory),
    JSON.stringify(databaseBackupTemplate(), null, 2) + "\n",
  );
  console.log("Prepared database-backup proposal locally; no AWS calls.");
}
