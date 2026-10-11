/** Generates infrastructure only; does not call AWS or attach access policies. */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const ref = (name) => ({ Ref: name }),
  sub = (value) => ({ "Fn::Sub": value });
const bucketArn = { "Fn::GetAtt": ["Recordings", "Arn"] };
const objects = sub("${Recordings.Arn}/tenants/${RecordingTenantId}/*");
const tags = [
  { Key: "OpenFolkPurpose", Value: "recording-backup" },
  { Key: "TenantId", Value: ref("RecordingTenantId") },
];
const versionRead = ["s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectRetention"];
const bucketRead = [
  "s3:GetBucketLocation",
  "s3:GetBucketVersioning",
  "s3:GetEncryptionConfiguration",
  "s3:GetBucketObjectLockConfiguration",
  "s3:GetBucketPublicAccessBlock",
  "s3:GetBucketPolicy",
  "s3:GetBucketOwnershipControls",
];
const list = {
  Effect: "Allow",
  Action: ["s3:ListBucket", "s3:ListBucketVersions"],
  Resource: bucketArn,
  Condition: { StringLike: { "s3:prefix": sub("tenants/${RecordingTenantId}/*") } },
};
const noDestruction = {
  Effect: "Deny",
  Action: [
    "s3:Delete*",
    "s3:BypassGovernanceRetention",
    "s3:PutObjectRetention",
    "s3:PutObjectLegalHold",
    "s3:PutBucket*",
    "s3:PutEncryptionConfiguration",
    "s3:PutLifecycleConfiguration",
  ],
  Resource: [bucketArn, sub("${Recordings.Arn}/*")],
};
export function recordingBackupTemplate() {
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "OpenFolk Drummonds recording backup foundation. London only; private retained versions; no runner, credentials or source transfer.",
    Metadata: {
      IntendedRegion: "eu-west-2",
      Activation:
        "Requires reviewed AWS account, scoped source-read mechanism and separate runner/restore identities. Policies are unattached.",
      BudgetScope:
        "AWS account-wide $5 monthly actual-cost alert, not a cap; excludes Supabase charges.",
    },
    Parameters: {
      ExpectedAccountId: {
        Type: "String",
        AllowedPattern: "^[0-9]{12}$",
        Description: "Verified OpenFolk AWS account ID; never deploy to a guessed account.",
      },
      RecordingTenantId: {
        Type: "String",
        Default: "00000000-0000-0000-0000-000000000001",
        AllowedValues: ["00000000-0000-0000-0000-000000000001"],
      },
      BudgetAlertEmail: {
        Type: "String",
        AllowedPattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
        Description: "OpenFolk owner-approved billing alert recipient.",
      },
    },
    Rules: {
      ExpectedAccountAndRegion: {
        Assertions: [
          {
            Assert: { "Fn::Equals": [ref("AWS::AccountId"), ref("ExpectedAccountId")] },
            AssertDescription: "This stack must run in the verified OpenFolk AWS account.",
          },
          {
            Assert: { "Fn::Equals": [ref("AWS::Region"), "eu-west-2"] },
            AssertDescription: "This backup is approved for London only.",
          },
        ],
      },
    },
    Resources: {
      Recordings: {
        Type: "AWS::S3::Bucket",
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
        Properties: {
          BucketName: sub("openfolk-drummonds-recordings-${AWS::AccountId}-eu-west-2"),
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
      RecordingPolicy: {
        Type: "AWS::S3::BucketPolicy",
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
        Properties: {
          Bucket: ref("Recordings"),
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Sid: "RequireTLS",
                Effect: "Deny",
                Principal: "*",
                Action: "s3:*",
                Resource: [bucketArn, sub("${Recordings.Arn}/*")],
                Condition: { Bool: { "aws:SecureTransport": "false" } },
              },
              {
                Sid: "RequireSSES3OnWrites",
                Effect: "Deny",
                Principal: "*",
                Action: "s3:PutObject",
                Resource: sub("${Recordings.Arn}/*"),
                Condition: { StringNotEquals: { "s3:x-amz-server-side-encryption": "AES256" } },
              },
              {
                Sid: "RequireCreateOnlyWrites",
                Effect: "Deny",
                Principal: "*",
                Action: "s3:PutObject",
                Resource: sub("${Recordings.Arn}/*"),
                Condition: {
                  Null: { "s3:if-none-match": "true" },
                  Bool: { "s3:ObjectCreationOperation": "true" },
                },
              },
            ],
          },
        },
      },
      BackupWriterPolicy: {
        Type: "AWS::IAM::ManagedPolicy",
        Properties: {
          Description:
            "Unattached: backup writer can create/verify tenant objects, never delete or bypass retention.",
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              { Effect: "Allow", Action: bucketRead, Resource: bucketArn },
              list,
              { Effect: "Allow", Action: [...versionRead, "s3:PutObject"], Resource: objects },
              noDestruction,
            ],
          },
        },
      },
      BackupRestorePolicy: {
        Type: "AWS::IAM::ManagedPolicy",
        Properties: {
          Description:
            "Unattached: restore identity can only inspect and read retained Drummonds versions.",
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              { Effect: "Allow", Action: bucketRead, Resource: bucketArn },
              list,
              { Effect: "Allow", Action: versionRead, Resource: objects },
              {
                Effect: "Deny",
                Action: [
                  "s3:Put*",
                  "s3:Delete*",
                  "s3:BypassGovernanceRetention",
                  "s3:RestoreObject",
                ],
                Resource: [bucketArn, sub("${Recordings.Arn}/*")],
              },
            ],
          },
        },
      },
      MonthlyCostAlert: {
        Type: "AWS::Budgets::Budget",
        Properties: {
          Budget: {
            BudgetName: "openfolk-recording-backup-account-watch",
            BudgetType: "COST",
            TimeUnit: "MONTHLY",
            BudgetLimit: { Amount: 5, Unit: "USD" },
            CostTypes: { IncludeCredit: false, IncludeRefund: false },
          },
          NotificationsWithSubscribers: [
            {
              Notification: {
                NotificationType: "ACTUAL",
                ComparisonOperator: "GREATER_THAN",
                Threshold: 100,
                ThresholdType: "PERCENTAGE",
              },
              Subscribers: [{ SubscriptionType: "EMAIL", Address: ref("BudgetAlertEmail") }],
            },
          ],
        },
      },
    },
    Outputs: {
      BucketName: { Value: ref("Recordings") },
      BucketArn: { Value: bucketArn },
      TenantPrefix: { Value: sub("tenants/${RecordingTenantId}/") },
      WriterPolicyArn: { Value: ref("BackupWriterPolicy") },
      RestorePolicyArn: { Value: ref("BackupRestorePolicy") },
      Region: { Value: ref("AWS::Region") },
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(" ") !== "--write-template")
    throw Error("Use --write-template; this command never deploys.");
  writeFileSync(
    "infrastructure/recording-backup/foundation.cloudformation.json",
    JSON.stringify(recordingBackupTemplate(), null, 2) + "\n",
  );
  console.log("Prepared local recording-backup foundation template; no AWS calls.");
}
