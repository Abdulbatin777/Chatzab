const {Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL,max:15});
const query=(t,p)=>pool.query(t,p);module.exports={pool,query};