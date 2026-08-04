import {
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
  NodePlaintextCredentialStore,
} from "../../../core/dist/node/index.js";

const homeResolver = new NodeConfigurationHomeResolver();
const configuration = await new NodeApplicationConfigurationStore({
  homeResolver,
}).load();
const reference = configuration?.modelConnections[0]?.credentialRef;
if (reference === undefined) process.exit(2);
const store = new NodePlaintextCredentialStore({ homeResolver });
const usable = await store.use(reference, async (secret) => secret.length > 0);
if (!usable) process.exit(3);
process.stdout.write("DESKTOP_CREDENTIAL_CHILD_USE_OK\n");
