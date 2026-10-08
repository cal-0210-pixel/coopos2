// Shows CoopOS deployed versions, build status and where it is live (deploy target).
import { RocketRideClient } from 'rocketride';
const APP = 'coopos_lab.coopos';
const client = new RocketRideClient({ uri: process.env.ROCKETRIDE_DEPLOY_URI, auth: process.env.ROCKETRIDE_DEPLOY_APIKEY });
await client.connect();
try {
	const versions = await client.listDeployments(APP);
	console.log(JSON.stringify(versions.map(({ registryVersion, state, buildStatus, rungs, message }) => ({ registryVersion, state, buildStatus, rungs, message })), null, 1));
	const latest = versions[0];
	if (latest?.buildStatus === 'failed') console.log((await client.buildLog(APP, latest.registryVersion)).log.slice(-3000));
	console.log('where:', JSON.stringify(await client.whereApp(APP)));
} finally {
	await client.disconnect();
}
