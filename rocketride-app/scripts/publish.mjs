// Publish a deployed CoopOS version to an audience. Usage: node --env-file=.env scripts/publish.mjs <version> <rung>
import { RocketRideClient } from 'rocketride';
const [version, rung] = [Number(process.argv[2]), process.argv[3]];
const client = new RocketRideClient({ uri: process.env.ROCKETRIDE_DEPLOY_URI, auth: process.env.ROCKETRIDE_DEPLOY_APIKEY });
await client.connect();
try {
	console.log(JSON.stringify(await client.publishApp('coopos_lab.coopos', version, rung)));
} finally {
	await client.disconnect();
}
