# Privacy Policy for X-Follow Assistant Pro

**Last Updated:** October 19, 2026

## Introduction
X-Follow Assistant Pro ("we", "our", or "the Extension") is a Chrome Extension designed to help users manage their X (Twitter) followers locally. We respect your privacy and are committed to protecting your personal data.

## Data Collection and Usage

**1. No External Data Collection**
The Extension operates entirely on your local device (client-side). We do not collect, store, transmit, or sell any of your personal data, login credentials, or browsing history to any external servers or third parties.

**2. Local Storage**
The Extension uses your browser's local storage (`chrome.storage.local`) for the sole purpose of:
*   Saving your user preferences (e.g., batch intervals, blue tick settings).
*   Storing a local history of operations (e.g., "Followed user X", "Unfollowed user Y") to provide you with an activity log.
*   Recording post and reply timeline API response items only after you click Start Capture on an X user profile, including profile identity, actual authors, text, media references, publication and capture times, engagement counts, and raw response items. These collections are separated by profile user ID and tab and may be exported by you as JSON files.
*   Deduplicating captured posts and updating their latest available metadata.

This data never leaves your browser and is deleted when you uninstall the Extension or explicitly remove the extension's stored data. Exported JSON files remain in the location you choose.

**3. Permissions**
*   **Host Permissions (`https://x.com/*`, `https://twitter.com/*`)**: Required to inject the automation script that interacts with the buttons on the page (Follow/Unfollow) on your behalf, and to observe the post/reply API responses already requested by the page.
*   **Storage**: Required to save settings, operation history, and captured timelines locally.
*   **Unlimited Storage**: Allows larger local collections with raw items; collections occupy local disk space and are not automatically evicted by the extension.

The capture feature is off by default. After you click Start Capture, it observes existing fetch/XMLHttpRequest responses for that user profile and Posts or Replies tab. Switching between Posts and Replies for the same profile keeps recording with separate collections. Stop Capture or navigating away from that profile’s Posts/Replies stops recording. Reloading the same profile preserves active capture, including initial timeline responses; scrolling resets to off. Relevant responses arriving during startup are held temporarily until the capture state is known and discarded if capture is off. Each saved user/tab collection can be cleared or exported separately. Active session controls use browser session storage, which does not survive a browser restart. Optional automatic scrolling has separate Start/Stop controls and moves the page every 2.5 seconds. Stopping scrolling does not stop capture, and stopping capture does not stop scrolling. Both default to off. The extension does not directly issue timeline API requests. It does not store request headers, cookies, or authentication tokens. JSON exports can contain profile information and tweet content; you control where these files are saved or shared.

## Third-Party Services
The Extension does not use any third-party analytics or tracking services (e.g., Google Analytics).

## Changes to This Policy
We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page.

## Contact Us
If you have any questions about this Privacy Policy, please contact us via the support link on the Chrome Web Store.


## Optional operation recording

Operation recording is off by default and starts only through the separate Start Recording control. It records the selected X tab’s trusted clicks, focus and input actions (without entered text), scrolling, page paths, nearby post IDs/permalinks, and dialog open/close events. Element metadata includes tag, role, test ID, and a label limited to 120 characters. URL query strings and fragments are removed. Password and designated sensitive input controls are excluded. It does not record keystrokes, mouse movement, entered text, cookies, or authentication headers. The extension neither generates nor publishes replies as part of recording.

Recording continues with the popup closed and across reloads/X navigation in the selected tab, until Stop Recording or the 5,000-event limit. Browser restart disables recording. Logs remain locally until explicitly cleared or the extension is uninstalled; subsequent recording sessions append. Users may export the logs as JSON; exported files remain where saved.


## Configurable reply test

The explicitly started reply test reads a text post from the X home feed or the currently opened post detail, enters the selected detail page, and stores the selected post identity, visible text, and test status locally for preview. A local adapter randomly chooses from 100 built-in short replies, without repeating a choice within the configured batch; no external reply-generation service is called. The test button explicitly states that it publishes. Clicking it authorizes filling an empty inline composer and clicking Reply once on the selected post. The test checks for a new reply from the signed-in account, waits a randomly chosen configured interval, and returns home. Users explicitly configure 1–50 posts and minimum/maximum interval seconds (0–3600, minimum no greater than maximum); defaults are three posts and 10–20 seconds. Single mode stops after returning home; multiple-post mode repeats only up to the configured count. Limited scrolling may load more unprocessed posts. Settings are persisted locally and locked during an active run. Before filling and before publishing, it waits a randomly chosen 5–10 seconds. Stop Test interrupts waiting and prevents subsequent submissions; already published replies are not removed. Rate limiting, errors, or uncertain publication halt the batch. Existing drafts are preserved. A persistent target reservation prevents repeating the same test submission; uncertain publication results are not retried. The latest test preview is replaced on the next test and removed when extension storage is cleared or the extension is uninstalled.


### Reply test diagnostic bundle

Starting a reply test automatically records bounded snapshots with a per-item budget of 30 plus 8 extra slots of the rendered primary content DOM, expanding to the body on failure. Editable/input content is redacted; scripts, embedded documents, arbitrary attributes, and URL query strings are excluded. Snapshots include selector matches, button/editor state, focus, bounding rectangles, and hit-test visibility. Stage traces and bounded error messages/stacks are saved locally. The export contains the latest test run and is replaced by the next test.

During the test, a page-world observer records metadata for existing HomeTimeline, HomeLatestTimeline, TweetDetail, and CreateTweet requests, including sanitized path, HTTP method/status, and elapsed time. It does not collect request headers, request bodies, or response bodies and sends no additional requests. Logging expires after 90 seconds without the active test’s heartbeat and normally stops when the test finishes, with a 1.5-second tail after a publish click. Network metadata is diagnostic evidence rather than proof of publication. Users explicitly export the local bundle through Export Full Test Diagnostics.


Reply selection excludes posts authored by the signed-in account, its confirmed generated reply IDs, and previously reserved targets. The account handle, candidate exclusion reasons, selected reply pool index, and pool size are recorded in the local diagnostic bundle. Confirmed generated reply IDs, account handles, parent post IDs, run IDs, and timestamps are stored locally for future exclusion. If account identification fails or changes, the test stops. No external text-generation service is used.

Diagnostic settings include the selected reply count, interval range, and actual per-item waits. A total ordinary HTML budget of approximately six million characters is divided across the configured run; error snapshots are retained preferentially. Request metadata counts are bounded according to batch size.
