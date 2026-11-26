# 24 News Control Center

The newsroom keeps the original dashboard, story editor, source directory, graphic studio and publishing queue. English and Dhivehi can be used independently or together. News Radar adds public leads for Haa Alif, Haa Dhaalu, Shaviyani, Noonu and Raa. It collects headlines and links from Thiladhun and VNews RSS and regional Google News RSS searches. Leads are deduplicated and retained for up to 30 days. Coverage depends on the publishers and the region names in `scripts/radar.py`.

## Prepare Firebase on Spark

1. Export a JSON backup from **Settings** on the existing live site in each browser containing newsroom data. The updated app can also explicitly import the original browser data when it runs at the same origin. Each restore replaces the shared newsroom, so choose the authoritative backup or consolidate multiple backups before importing.
2. In Firebase Console, create or select a dedicated **Spark** project. Keep billing disabled. Create the default Firestore database in production mode and enable **Google** under Authentication → Sign-in method. Add `aleehaxan.github.io` to Authentication → Settings → Authorized domains. For local testing, explicitly add `localhost` if needed.
3. Register a Firebase web app and copy the public Firebase SDK values into `firebase-config.json`. Use `apiKey`, `authDomain`, `projectId`, and `appId`. Firebase web configuration identifies the project and is delivered to every visitor. Keep passwords, service account JSON, OAuth client secrets and Meta tokens out of Git and the site.
4. As a project owner, deploy the rules and index exemptions from this checkout using the Firebase CLI.

   ```sh
   firebase login
   firebase deploy --only firestore:rules,firestore:indexes --project YOUR_SPARK_PROJECT_ID
   ```

5. Have each intended admin sign in once. Firebase Authentication records the account even if the newsroom access check fails. Copy the user UID from Authentication → Users. In the Firestore console, create a document at `admins/<uid>` (for example, with a boolean `enabled: true` field). Document existence grants access. Delete the membership document to revoke access. The UI uses browser-session auth and requires a server-confirmed membership and newsroom snapshot on sign-in. The rules require a verified Google identity and membership. Admin records can only be managed through trusted project access.

## Prepare GitHub Pages

1. Review the updated files on a branch. Before merging, complete the Firebase steps and verify the intended account against a local preview (`python3 -m http.server 3000`) using public Firebase configuration. Never use a production backup in a test project.
2. In **ALeehaxan/24-news-control** under Settings → Pages, select **GitHub Actions** as the build source. Enable Actions for the repository and allow the Radar workflow to commit its public `radar.json` snapshot to the default branch. If branch rules prohibit the workflow’s write, the collector needs an allowed commit path before scheduled refreshes can deploy.
3. Merge to `main`. The **News Radar and GitHub Pages** workflow tests and packages the static app, and skips publishing when the Firebase web configuration is empty. It collects new leads every six hours at minute 17 UTC, and can be run via **Actions → News Radar and GitHub Pages → Run workflow**. GitHub can delay scheduled runs, and may disable them after prolonged repository inactivity. The workflow deploys the same snapshot it collects, since a bot commit alone does not trigger a new Pages run.
4. At the Pages URL, verify that a non-admin Google account cannot open the newsroom. Sign in as an admin from two devices, save a draft on one, and check that it appears on the other. Restore the chosen backup from Settings. Verify Radar and both poster languages.

Firestore sync covers stories, approval states and source entries. Photos stay in the editing session. A save checks the record read by the editor and the shared revision before committing. The shared newsroom document rejects saves above an 800 KB JSON budget, so retain periodic backups and archive older material as needed. Spark quotas bound service use and can interrupt sync if exhausted. GitHub Pages and standard scheduled runners for this public repository require no paid plan.

## Facebook and Instagram

1. Verify the facts, translation, source URL and image rights in the editor. Approve the saved story.
2. From Publishing, export the approved bilingual caption. Open the approved story in the editor and load the reviewed photo. Select the poster language and export the approved social poster. Both approved exports check the current Firestore copy before generating files. The general graphic studio remains available for draft previews and exports.
3. In Meta Business Suite, select the Facebook Page and connected professional Instagram account. Upload the poster and paste the relevant caption. Review each platform preview before publishing, then mark the story posted in the newsroom. The newsroom stores a single manual posting status.
4. Direct Graph API publishing would require separate authorization for the owned Page and professional Instagram account, an approved Meta app with the required scopes, a trusted publisher, accessible media for the Instagram publishing endpoint, and persistent per-platform delivery records. Keep this workflow manual until that setup is authorized and verified. The static app holds no Meta credentials and makes no publish requests.

## Local checks

```sh
node --input-type=module --check < js/app.js
node --input-type=module --check < js/studio.js
node --test tests/data.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/radar.py --output /tmp/24-news-radar.json
```

For the Firestore rules and second-client sync test, install `firebase-tools`, `firebase` and `@firebase/rules-unit-testing` in a temporary directory and use a recent Node.js and Java. Run from the repository.

```sh
qa_dir=$(mktemp -d)
npm install --prefix "$qa_dir" firebase-tools firebase @firebase/rules-unit-testing
NODE_PATH="$qa_dir/node_modules" "$qa_dir/node_modules/.bin/firebase" emulators:exec \
  --only firestore --project demo-24-news 'node --test tests/firestore.test.cjs'
```
