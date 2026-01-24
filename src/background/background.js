import { sendGAEvent } from '../utils/analytics.js';

/**
 * Background Service Worker
 */

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        // Initialize Default Storage
        await chrome.storage.local.set({
            license: {
                key: null,
                type: 'FREE',
                activatedAt: null
            },
            usage: {
                currentMonth: new Date().toISOString().slice(0, 7), // "2026-01"
                followCount: 0,
                unfollowCount: 0
            }
        });
        
        sendGAEvent('app_install');
        console.log('X-Follow: Installed and storage initialized.');
    }
});

// Listen for messages from Popup or Content to proxy GA events
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GA_EVENT') {
        sendGAEvent(message.payload.name, message.payload.params);
    }
});
