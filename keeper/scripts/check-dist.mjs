import { buildProgram } from "../src/client.js";
const { program } = buildProgram();
const dists = await program.account.distribution.all();
console.log("distributions:", dists.length);
for (const d of dists) {
  console.log(d.publicKey.toBase58(), "finished=", d.account.finished, "cursor=", d.account.cursor, "leafCount=", d.account.leafCount, "sent=", d.account.sent.toString(), "total=", d.account.total.toString());
}
