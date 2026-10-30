import type {InvoiceLine} from '@inveos/contracts';

// These are declared synthetic arithmetic rules, not statutory tax calculations.
export function halfUp(numerator:bigint,denominator:bigint):bigint {
 if(numerator<0n||denominator<=0n)throw new Error('Only nonnegative invoice arithmetic is supported.');
 return (numerator+denominator/2n)/denominator;
}
export function exactMinor(value:bigint):number {
 if(value<0n||value>5_000_000_000_000n)throw new Error('Internal invoice amount limit exceeded.');
 return Number(value);
}
export function lineAmounts(kind:'time'|'expense',quantity:number,rateMinor:number,taxBasisPoints:number){
 for(const value of [quantity,rateMinor,taxBasisPoints])if(!Number.isSafeInteger(value)||value<0)throw new Error('Invoice values must be nonnegative safe integers.');
 const net=kind==='time'?halfUp(BigInt(quantity)*BigInt(rateMinor),60n):BigInt(rateMinor);
 const tax=halfUp(net*BigInt(taxBasisPoints),10000n);
 return {netMinor:exactMinor(net),taxMinor:exactMinor(tax),totalMinor:exactMinor(net+tax)};
}
export function invoiceTotals(lines:Pick<InvoiceLine,'netMinor'|'taxMinor'>[]){
 const net=lines.reduce((sum,line)=>sum+BigInt(line.netMinor),0n),tax=lines.reduce((sum,line)=>sum+BigInt(line.taxMinor),0n);
 return {netMinor:exactMinor(net),taxMinor:exactMinor(tax),totalMinor:exactMinor(net+tax)};
}
