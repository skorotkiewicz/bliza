import { json } from '@sveltejs/kit';
import { db } from 'openrails';
export async function GET() {
	try { await db.transaction({});return json({ready:true},{headers:{'Cache-Control':'no-store'}}); }
	catch { return json({ready:false},{status:503,headers:{'Cache-Control':'no-store'}}); }
}
