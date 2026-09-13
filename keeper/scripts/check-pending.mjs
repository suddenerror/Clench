import { buildProgram } from "../src/client.js";
const { program } = buildProgram();
const pendings = await program.account.pending.all();
console.log("pending accounts:", pendings.length);
for (const p of pendings) {
  console.log(p.publicKey.toBase58(), "owner=", p.account.owner.toBase58(), "amount=", p.account.amount.toString());
}
