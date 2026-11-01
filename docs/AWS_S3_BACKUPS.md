# Optional approved resume cloud backup

The web app, API, PostgreSQL and LangGraph run locally. AWS S3 stores only PDFs of resumes explicitly approved and backed up by the signed-in user. Existing local DOCX/PDF downloads do not depend on AWS. No model provider changes are required.

## Local configuration

Install locked dependencies with `npm ci`. Add these settings to the existing private `.env`, without replacing its other settings:

```
S3_BACKUP_BUCKET=<CloudFormation BucketName output>
AWS_REGION=ap-southeast-2
AWS_PROFILE=careerflow
```

Authenticate through AWS browser login using the chosen profile. The AWS JavaScript SDK resolves credentials locally; credentials never go to the frontend or source repository. Use a limited IAM identity for the application, not a root/admin identity. The application needs `s3:ListBucket` limited to prefix `approved-resumes/*`, and `s3:PutObject`/`s3:GetObject` on that prefix's objects. No delete, public access or policy-management permissions are required by the app. The server's identity is trusted for all app users; application authentication and hashed user prefixes isolate users.

For Docker on your own macOS/Linux demo computer, add `COMPOSE_FILE=compose.yaml:compose.aws-profile.yaml` to the private `.env`, then use normal `docker compose up -d --build --wait`. No Python helper is required. This runtime override mounts host config read-only and the login cache read/write (SDK refresh persists renewed sessions). Static credentials are not mounted. Credentials remain outside source/image. The app can access the mounted login cache, so use this only on a trusted local computer. An expired overall login still requires browser authentication. Host paths default to `~/.aws/config` and `~/.aws/login/cache`; override with `AWS_HOST_CONFIG` / `AWS_HOST_LOGIN_CACHE` if needed.

The previous Python helper and `compose.aws.yaml` remain an alternative that injects an exported temporary session without mounting host files. Do not combine it with the profile override. Without S3, unset COMPOSE_FILE and leave the bucket blank.

The existing bucket can be reused after downloading a fresh source archive; do not create a new bucket for every demonstration. A fresh application database still requires a new account/profile/resume, and application ownership scopes its backup list. Network access and valid S3 permissions remain necessary. Storage, access-log and request charges continue to apply. An IAM role is preferable on a hosted runtime.

## User flow

1. Open an approved resume under My documents.
2. Choose **Back up approved PDF to cloud**. This explicit action sends the approved PDF to AWS.
3. Expand **Cloud backups** to list the signed-in user's backed-up approved versions.
4. Choose a download. The local server authorizes the user and redirects to an S3 link valid for 60 seconds. Anyone holding that link can download during its lifetime; the bucket remains private.

An approved resume has an immutable identity. Repeating its backup uses the same opaque object key; separate approved resume records have separate keys. S3 versioning retains object revisions, but the application lists logical approved versions, not every S3 version. Listing uses all S3 pages. No names or email addresses appear in object keys. The bucket setting can be left blank to disable cloud backup. A storage failure displays a retry message and leaves local downloads available.

## Infrastructure

`infra/aws/resume-backups.yaml` declares a private account-regional backup bucket and a separate access-log bucket in the deployment region. It enables default SSE-S3 encryption, versioning for PDFs, HTTPS-only access, and expires access logs after 30 days. New S3 buckets use public access blocking and disabled ACLs by default; deployment verification must check those actual controls. CloudFormation retains the buckets on stack deletion to avoid accidental document loss. Deleting the stack is therefore not complete cleanup; remove objects/versions and retained buckets deliberately when no longer needed. Storage and request charges apply.

The AWS Toolkit catalog is in us-east-1; application storage is in ap-southeast-2. The toolkit's region is not the bucket's region.
