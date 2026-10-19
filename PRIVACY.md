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

The capture feature is off by default. After you click Start Capture, it observes existing fetch/XMLHttpRequest responses for that user profile and Posts or Replies tab. Stop Capture, navigation to another page, or refreshing the document stops recording. Each saved user/tab collection can be cleared or exported separately. Active session controls use browser session storage, which does not survive a browser restart. It does not initiate additional timeline requests. It does not store request headers, cookies, or authentication tokens. JSON exports can contain profile information and tweet content; you control where these files are saved or shared.

## Third-Party Services
The Extension does not use any third-party analytics or tracking services (e.g., Google Analytics).

## Changes to This Policy
We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page.

## Contact Us
If you have any questions about this Privacy Policy, please contact us via the support link on the Chrome Web Store.
