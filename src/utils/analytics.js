/**
 * Google Analytics 4 Helper (Measurement Protocol)
 * Because standard gtag.js is difficult in MV3 Service Workers.
 */

const GA_MEASUREMENT_ID = 'G-0TJ1S19XXH'; // Updated with your ID
const GA_API_SECRET = 'mcAHpawfT1OsPjiZxw2ciw'; // Updated with your API Secret

export async function sendGAEvent(name, params = {}) {
    try {
        const result = await chrome.storage.local.get(['clientId']);
        let clientId = result.clientId;
        
        if (!clientId) {
            clientId = self.crypto.randomUUID();
            await chrome.storage.local.set({ clientId });
        }

        const body = {
            client_id: clientId,
            events: [{
                name: name,
                params: {
                    ...params,
                    engagement_time_msec: 1
                }
            }]
        };

        // Note: For real GA4 tracking without a backend, 
        // you might use the standard Measurement Protocol URL.
        // We'll use a fetch call.
        await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    } catch (e) {
        console.error('GA Error:', e);
    }
}
