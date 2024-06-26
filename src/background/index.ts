import { getStorageItem, setStorageItem } from '@/lib/storage'
import { registerContentScript, unregisterContentScript } from './helpers'
import { ExtensionMessage } from './types'

//@ts-ignore
import anyName from '@/src/content-scripts/index?script'

let backendPort: number = 1893;

chrome.runtime.onMessage.addListener(
	async (message: ExtensionMessage, sender, sendResponse) => {
		switch (message.action) {
			case 'registerContentScript':
				await registerContentScript([
					{
						id: message.scriptName,
						js: [anyName],
						runAt: 'document_end',
						matches: ['http://*/*', 'https://*/*'],
					},
				])
				break
			case 'unregisterContentScript':
				await unregisterContentScript([message.scriptName])
				break
			case 'getStorageItem':
				const storageItem = await getStorageItem(message.key)
				console.log(storageItem)
				break
		}
	}
)

chrome.runtime.onConnect.addListener(port => {
	console.log('Connected to background script', port);
});

chrome.runtime.onInstalled.addListener(() => {
	console.log('Extension installed');
	findServicePort().then(port => {
		if (port) {
			backendPort = port;
			console.log('Found backend port', backendPort);
		} else {
			console.log('No backend found');
		}
	});
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
	console.log(activeInfo);
	const tabId = activeInfo.tabId;
	const tab = await chrome.tabs.get(tabId);
	if (tab.url) {
		console.log('Tab updated', tab.url);
		const hostname = new URL(tab.url).hostname;
		const domain = hostname.split('.').slice(-2).join('.');
		await setStorageItem('activeDomain', domain);
		await setStorageItem('activeUrl', tab.url);
	}
});

interface WebpageUsage {
	url: string;
	domain: string;
	startTime: number; // in second
	duration: number;
}

async function findServicePort(): Promise<number | null> {
	const startPort = 1893;
	const endPort = 1949;
	const targetResponse = {
		name: 'ShiduWatcher',
		status: 'running'
	};

	for (let port = startPort; port <= endPort; port++) {
		try {
			const response = await fetch(`http://localhost:${port}/control/status`);
			if (response.ok) {
				const data = await response.json();
				if (data.name === targetResponse.name && data.status === targetResponse.status) {
					return port;
				}
			}
		} catch (error) {
			// Ignore errors and continue to the next port
		}
	}

	return null; // Return null if no service is found
}

function report({ url, domain, startTime, duration }: WebpageUsage) {
	console.log('Reporting', domain, 'for', duration, 'ms');
	try {
		fetch(`http://localhost:${backendPort}/usagereport/webpage-usage-report`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				url,
				domain,
				startTime: new Date(startTime),
				// TimeSpan (HH:mm:ss format)
				duration: formatTimeSpan(duration)
			})
		});
	} catch (error) {
		console.error('Failed to report usage', error);
	}
}

function formatTimeSpan(durationMs: number) {
	const numHour = Math.floor(durationMs / 3600000);
	const numMinute = Math.floor((durationMs % 3600000) / 60000);
	const numSecond = Math.floor((durationMs % 60000) / 1000);
	return `${numHour.toString().padStart(2, '0')}:${numMinute.toString().padStart(2, '0')}:${numSecond.toString().padStart(2, '0')}`;
}

(async () => {
	let currentUsage: WebpageUsage | undefined;
	let checkInterval = 1000; // Check every second by default

	setInterval(async () => {
		const activeDomain = await getStorageItem('activeDomain');
		const activeUrl = await getStorageItem('activeUrl');

		if (!activeUrl && !activeDomain) {
			return;
		}

		if (!currentUsage) {
			currentUsage = {
				url: activeUrl,
				domain: activeDomain,
				startTime: new Date().getTime(),
				duration: 0
			}
			return;
		}

		if (activeUrl !== currentUsage.url) {
			const duration = new Date().getTime() - currentUsage.startTime;
			report({
				...currentUsage,
				duration
			});
			currentUsage = {
				url: activeUrl,
				domain: activeDomain,
				startTime: new Date().getTime(),
				duration: 0
			}
		}
	}, checkInterval);
})();
