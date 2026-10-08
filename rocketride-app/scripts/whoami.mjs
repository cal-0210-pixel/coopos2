import { RocketRideClient } from 'rocketride';
const client = new RocketRideClient({ uri: process.env.ROCKETRIDE_DEPLOY_URI, auth: process.env.ROCKETRIDE_DEPLOY_APIKEY });
const info = await client.connect();
const o = info.organization;
console.log(JSON.stringify({ capabilities: info.capabilities, devTeam: info.devTeam, org: o && { name: o.name, developerId: o.developerId, permissions: o.permissions, teams: o.teams?.map((t) => ({ name: t.name, id: t.id, permissions: t.permissions })) } }, null, 1));
await client.disconnect();
