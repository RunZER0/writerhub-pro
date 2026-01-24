const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const crypto = require('crypto');

// Brevo email setup
const Brevo = require('@getbrevo/brevo');
const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

// Disposable/temporary email domains to block (comprehensive list)
const DISPOSABLE_EMAIL_DOMAINS = new Set([
    // Common disposable email services
    'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempail.com', 'tempr.email',
    'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz',
    'mailinator.com', 'mailinator.net', 'mailinator.org', 'mailinator2.com',
    '10minutemail.com', '10minutemail.net', '10minutemail.org', '10minmail.com',
    'throwaway.email', 'throwawaymail.com', 'throam.com',
    'fakeinbox.com', 'fakemailgenerator.com', 'fakemail.net',
    'trashmail.com', 'trashmail.net', 'trashmail.org', 'trashemail.de',
    'yopmail.com', 'yopmail.fr', 'yopmail.net', 'cool.fr.nf', 'jetable.fr.nf',
    'dispostable.com', 'discard.email', 'discardmail.com', 'discardmail.de',
    'mailcatch.com', 'mailnesia.com', 'mailnull.com',
    'spamgourmet.com', 'spambox.us', 'spamfree24.org', 'spamherelots.com',
    'maildrop.cc', 'mailsac.com', 'mailslurp.com',
    'getnada.com', 'nada.email', 'tempinbox.com', 'tempinbox.co.uk',
    'sharklasers.com', 'spam4.me', 'grr.la', 'guerrillamailblock.com',
    'pokemail.net', 'emailondeck.com', 'anonymmail.net',
    'mintemail.com', 'mytrashmail.com', 'mt2009.com', 'trash2009.com',
    'bugmenot.com', 'bumpymail.com', 'buyusedlibrarybooks.org',
    'despam.it', 'despammed.com', 'devnullmail.com', 'dfgh.net',
    'dodgeit.com', 'dodgit.com', 'dodgit.org', 'dontreg.com', 'dontsendmespam.de',
    'e4ward.com', 'emailias.com', 'emailigo.de', 'emailsensei.com', 'emailtemporario.com.br',
    'emailthe.net', 'emailto.de', 'emailwarden.com', 'emailx.at.hm', 'emailxfer.com',
    'emz.net', 'enterto.com', 'ephemail.net', 'etranquil.com', 'etranquil.net',
    'evopo.com', 'explodemail.com', 'express.net.ua', 'eyepaste.com',
    'fastacura.com', 'fastchevy.com', 'fastchrysler.com', 'fastkawasaki.com', 'fastmazda.com',
    'fastnissan.com', 'fastsubaru.com', 'fastsuzuki.com', 'fasttoyota.com', 'fastyamaha.com',
    'filzmail.com', 'fixmail.tk', 'fizmail.com', 'flyspam.com', 'footard.com',
    'forgetmail.com', 'fr33mail.info', 'frapmail.com', 'friendlymail.co.uk',
    'garliclife.com', 'gehensiull.com', 'get1mail.com', 'get2mail.fr', 'getairmail.com',
    'getmails.eu', 'getonemail.com', 'getonemail.net', 'ghosttexter.de',
    'girlsundertheinfluence.com', 'gishpuppy.com', 'goemailgo.com', 'gorillaswithdirtyarmpits.com',
    'gotmail.com', 'gotmail.net', 'gotmail.org', 'gotti.otherinbox.com',
    'great-host.in', 'greensloth.com', 'gsrv.co.uk', 'guerillamail.biz', 'guerillamail.com',
    'guerillamail.de', 'guerillamail.info', 'guerillamail.net', 'guerillamail.org',
    'gustr.com', 'h8s.org', 'haltospam.com', 'harakirimail.com', 'hatespam.org',
    'herp.in', 'hidemail.de', 'hidzz.com', 'hmamail.com', 'hochsitze.com',
    'hopemail.biz', 'hotpop.com', 'hulapla.de', 'ieatspam.eu', 'ieatspam.info',
    'ieh-mail.de', 'ihateyoualot.info', 'iheartspam.org', 'imails.info', 'imgof.com',
    'imgv.de', 'imstations.com', 'inbax.tk', 'inbox.si', 'inboxalias.com',
    'inboxclean.com', 'inboxclean.org', 'incognitomail.com', 'incognitomail.net',
    'incognitomail.org', 'infocom.zp.ua', 'insorg-mail.info', 'instant-mail.de',
    'ip6.li', 'ipoo.org', 'irish2me.com', 'iwi.net', 'jetable.com', 'jetable.net',
    'jetable.org', 'jnxjn.com', 'jobbikszansen.com', 'jourrapide.com', 'jsrsolutions.com',
    'kasmail.com', 'kaspop.com', 'keepmymail.com', 'killmail.com', 'killmail.net',
    'kimsdisk.com', 'klassmaster.com', 'klassmaster.net', 'klzlv.com', 'kulturbetrieb.info',
    'kurzepost.de', 'lackmail.net', 'lags.us', 'landmail.co', 'lastmail.co',
    'lavabit.com', 'letthemeatspam.com', 'lhsdv.com', 'lifebyfood.com', 'link2mail.net',
    'litedrop.com', 'loadby.us', 'login-email.ml', 'lol.ovpn.to', 'lookugly.com',
    'lopl.co.cc', 'lortemail.dk', 'lovemeleaveme.com', 'lr78.com', 'luckymail.org',
    'maboard.com', 'mail-hierarchie.net', 'mail.by', 'mail.mezimages.net', 'mail.zp.ua',
    'mail114.net', 'mail333.com', 'mail4trash.com', 'mailbidon.com', 'mailblocks.com',
    'mailbucket.org', 'mailcat.biz', 'mailcity.com', 'mailde.de', 'mailde.info',
    'maildrop.cf', 'maildrop.ga', 'maildrop.gq', 'maildrop.ml', 'maildx.com',
    'mailed.ro', 'maileater.com', 'mailexpire.com', 'mailfa.tk', 'mailforspam.com',
    'mailfree.ga', 'mailfreeonline.com', 'mailguard.me', 'mailhazard.com', 'mailhazard.us',
    'mailhz.me', 'mailimate.com', 'mailin8r.com', 'mailinater.com', 'mailincubator.com',
    'mailismagic.com', 'mailjunk.cf', 'mailjunk.ga', 'mailjunk.gq', 'mailjunk.ml',
    'mailjunk.tk', 'mailmate.com', 'mailme.gq', 'mailme.ir', 'mailme.lv', 'mailme24.com',
    'mailmetrash.com', 'mailmoat.com', 'mailnator.com', 'mailnull.com', 'mailorg.org',
    'mailpick.biz', 'mailquack.com', 'mailrock.biz', 'mailseal.de', 'mailshell.com',
    'mailsiphon.com', 'mailslapping.com', 'mailspam.xyz', 'mailtemp.info', 'mailtothis.com',
    'mailzilla.com', 'mailzilla.org', 'makemetheking.com', 'manifestgenerator.com',
    'manybrain.com', 'mbx.cc', 'mega.zik.dj', 'meinspamschutz.de', 'meltmail.com',
    'messagebeamer.de', 'mezimages.net', 'mierdamail.com', 'migmail.pl', 'migumail.com',
    'ministry-of-silly-walks.de', 'mintemail.com', 'misterpinball.de', 'mmmmail.com',
    'moakt.com', 'mobi.web.id', 'mobileninja.co.uk', 'moburl.com', 'mohmal.com',
    'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf', 'monumentmail.com',
    'ms9.mailslite.com', 'msa.minsmail.com', 'msb.minsmail.com', 'msg.mailslite.com',
    'mxfuel.com', 'my10minutemail.com', 'mycleaninbox.net', 'myemailboxy.com',
    'mymail-in.net', 'mymailoasis.com', 'mynetstore.de', 'mypacks.net', 'mypartyclip.de',
    'myphantomemail.com', 'myspaceinc.com', 'myspaceinc.net', 'myspacepimpedup.com',
    'myspamless.com', 'mytempemail.com', 'mytempmail.com', 'mytrashmail.com',
    'nabuma.com', 'neomailbox.com', 'nervmich.net', 'nervtmansen.com', 'netmails.com',
    'netmails.net', 'netzidiot.de', 'neverbox.com', 'nice-4u.com', 'nincsmail.hu',
    'nmail.cf', 'nobulk.com', 'noclickemail.com', 'nogmailspam.info', 'nomail.pw',
    'nomail.xl.cx', 'nomail2me.com', 'nomorespamemails.com', 'nospam.ze.tc', 'nospam4.us',
    'nospamfor.us', 'nospammail.net', 'nospamthanks.info', 'notmailinator.com',
    'notsharingmy.info', 'nowhere.org', 'nowmymail.com', 'ntlhelp.net', 'nurfuerspam.de',
    'nus.edu.sg', 'nwldx.com', 'objectmail.com', 'obobbo.com', 'odnorazovoe.ru',
    'oneoffemail.com', 'onewaymail.com', 'online.ms', 'oopi.org', 'opayq.com',
    'ordinaryamerican.net', 'otherinbox.com', 'ourklips.com', 'outlawspam.com',
    'ovpn.to', 'owlpic.com', 'pancakemail.com', 'pimpedupmyspace.com', 'pjjkp.com',
    'plexolan.de', 'poczta.onet.pl', 'politikerclub.de', 'poofy.org', 'pookmail.com',
    'pop3.xyz', 'proxymail.eu', 'prtnx.com', 'punkass.com', 'putthisinyourspamdatabase.com',
    'pwrby.com', 'q314.net', 'qisdo.com', 'qisoa.com', 'quickinbox.com',
    'quickmail.nl', 'rainmail.biz', 'rcpt.at', 're-gister.com', 'reallymymail.com',
    'realtyalerts.ca', 'receiveee.chickenkiller.com', 'receiveee.com', 'recode.me',
    'recursor.net', 'recyclemail.dk', 'regbypass.com', 'regbypass.comsafe-mail.net',
    'rejectmail.com', 'remail.cf', 'remail.ga', 'rhyta.com', 'rklips.com',
    'rmqkr.net', 'rppkn.com', 'rtrtr.com', 's0ny.net', 'safe-mail.net',
    'safersignup.de', 'safetymail.info', 'safetypost.de', 'sandelf.de', 'saynotospams.com',
    'selfdestructingmail.com', 'sendspamhere.com', 'sharklasers.com', 'shieldemail.com',
    'shiftmail.com', 'shitmail.me', 'shortmail.net', 'showslow.de', 'sibmail.com',
    'sinnlos-mail.de', 'siteposter.net', 'skeefmail.com', 'slaskpost.se', 'slave-auctions.net',
    'slopsbox.com', 'slowslow.de', 'smap.4nmv.ru', 'smashmail.de', 'smellfear.com',
    'snakemail.com', 'sneakemail.com', 'snkmail.com', 'sofimail.com', 'sofort-mail.de',
    'sogetthis.com', 'solvemail.info', 'soodomail.com', 'soodonims.com', 'spam.la',
    'spam.su', 'spam4.me', 'spamavert.com', 'spambob.com', 'spambob.net', 'spambob.org',
    'spambog.com', 'spambog.de', 'spambog.net', 'spambog.ru', 'spambox.info',
    'spambox.irishspringrealty.com', 'spambox.us', 'spamcannon.com', 'spamcannon.net',
    'spamcero.com', 'spamcon.org', 'spamcorptastic.com', 'spamcowboy.com', 'spamcowboy.net',
    'spamcowboy.org', 'spamday.com', 'spameater.com', 'spameater.org', 'spamex.com',
    'spamfree.eu', 'spamfree24.com', 'spamfree24.de', 'spamfree24.eu', 'spamfree24.info',
    'spamfree24.net', 'spamfree24.org', 'spamgoes.in', 'spamherelots.com', 'spamhereplease.com',
    'spamhole.com', 'spamify.com', 'spaminator.de', 'spamkill.info', 'spaml.com',
    'spaml.de', 'spamlot.net', 'spammotel.com', 'spamobox.com', 'spamoff.de',
    'spamsalad.in', 'spamslicer.com', 'spamspot.com', 'spamstack.net', 'spamthis.co.uk',
    'spamtroll.net', 'speed.1s.fr', 'spoofmail.de', 'squizzy.de', 'ssoia.com',
    'startkeys.com', 'stinkefinger.net', 'stop-my-spam.cf', 'stop-my-spam.com',
    'stop-my-spam.ga', 'stop-my-spam.ml', 'stop-my-spam.tk', 'streetwisemail.com',
    'stuffmail.de', 'super-auswahl.de', 'supergreatmail.com', 'supermailer.jp',
    'superrito.com', 'superstachel.de', 'suremail.info', 'svk.jp', 'sweetxxx.de',
    'tafmail.com', 'tagyourself.com', 'talkinator.com', 'tapchicuoihoi.com',
    'techemail.com', 'techgroup.me', 'teewars.org', 'teleosaurs.xyz', 'teleworm.com',
    'teleworm.us', 'temp.emeraldwebmail.com', 'temp15qm.com', 'tempail.com',
    'tempalias.com', 'tempe-mail.com', 'tempemail.biz', 'tempemail.co.za', 'tempemail.com',
    'tempemail.net', 'tempinbox.co.uk', 'tempinbox.com', 'tempmail.co', 'tempmail.de',
    'tempmail.eu', 'tempmail.it', 'tempmail.net', 'tempmail.us', 'tempmail2.com',
    'tempmaildemo.com', 'tempmailer.com', 'tempmailer.de', 'tempomail.fr', 'temporarily.de',
    'temporarioemail.com.br', 'temporaryemail.net', 'temporaryemail.us', 'temporaryforwarding.com',
    'temporaryinbox.com', 'temporarymailaddress.com', 'tempthe.net', 'thankspam.net',
    'thankyou2010.com', 'thecloudindex.com', 'thelimestones.com', 'thisisnotmyrealemail.com',
    'throam.com', 'throwam.com', 'throwawayemailaddress.com', 'throwawaymail.com',
    'tilien.com', 'tittbit.in', 'tmailinator.com', 'toiea.com', 'toomail.biz',
    'tradermail.info', 'trash-amil.com', 'trash-mail.at', 'trash-mail.com', 'trash-mail.de',
    'trash-mail.ga', 'trash-mail.gq', 'trash-mail.ml', 'trash-mail.tk', 'trash2009.com',
    'trash2010.com', 'trash2011.com', 'trashcanmail.com', 'trashdevil.com', 'trashdevil.de',
    'trashemail.de', 'trashmail.at', 'trashmail.com', 'trashmail.de', 'trashmail.me',
    'trashmail.net', 'trashmail.org', 'trashmail.ws', 'trashmailer.com', 'trashymail.com',
    'trashymail.net', 'trbvm.com', 'trickmail.net', 'trillianpro.com', 'tryalert.com',
    'turual.com', 'twinmail.de', 'twoweirdtricks.com', 'tyldd.com', 'uggsrock.com',
    'umail.net', 'upliftnow.com', 'uplipht.com', 'uroid.com', 'us.af', 'valemail.net',
    'venompen.com', 'veryrealemail.com', 'viditag.com', 'viralplays.com', 'vkcode.ru',
    'vomoto.com', 'vpn.st', 'vsimcard.com', 'vubby.com', 'walala.org', 'walkmail.net',
    'webemail.me', 'webm4il.info', 'webuser.in', 'wee.my', 'weg-werf-email.de',
    'wegwerf-email-addressen.de', 'wegwerf-emails.de', 'wegwerfadresse.de', 'wegwerfemail.com',
    'wegwerfemail.de', 'wegwerfmail.de', 'wegwerfmail.info', 'wegwerfmail.net', 'wegwerfmail.org',
    'wetrainbayarea.com', 'wetrainbayarea.org', 'wh4f.org', 'whatiaas.com', 'whatpaas.com',
    'whopy.com', 'whtjddn.33mail.com', 'whyspam.me', 'wilemail.com', 'willhackforfood.biz',
    'willselfdestruct.com', 'winemaven.info', 'wolfsmail.tk', 'wollan.info', 'worldspace.link',
    'wronghead.com', 'wuzup.net', 'wuzupmail.net', 'wwwnew.eu', 'x.ip6.li',
    'xagloo.com', 'xemaps.com', 'xents.com', 'xmaily.com', 'xoxy.net', 'yapped.net',
    'yeah.net', 'yep.it', 'yogamaven.com', 'yopmail.com', 'yopmail.fr', 'yopmail.gq',
    'yopmail.net', 'you-spam.com', 'yourdomain.com', 'ypmail.webarnak.fr.eu.org',
    'yuurok.com', 'zehnminuten.de', 'zehnminutenmail.de', 'zetmail.com', 'zippymail.info',
    'zoaxe.com', 'zoemail.com', 'zoemail.net', 'zoemail.org', 'zomg.info', 'zxcv.com',
    'zxcvbnm.com', 'zzz.com'
]);

// Check if email domain is disposable
function isDisposableEmail(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return true;
    return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

// Send verification email via Brevo
async function sendVerificationEmail(email, name, token) {
    const verifyUrl = `${process.env.BASE_URL || 'https://www.homeworkpal.online'}/api/membership/verify?token=${token}`;
    
    const sendSmtpEmail = new Brevo.SendSmtpEmail();
    sendSmtpEmail.sender = { name: 'HomeworkPal', email: process.env.SENDER_EMAIL || 'noreply@homeworkpal.com' };
    sendSmtpEmail.to = [{ email: email, name: name }];
    sendSmtpEmail.subject = 'Verify Your HomeworkPal Account';
    sendSmtpEmail.htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .header h1 { color: white; margin: 0; font-size: 28px; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
                .verify-btn { display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                .benefits { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
                .benefit { padding: 8px 0; border-bottom: 1px solid #eee; }
                .benefit:last-child { border-bottom: none; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🎓 HomeworkPal</h1>
                </div>
                <div class="content">
                    <h2>Welcome, ${name}! 👋</h2>
                    <p>Thank you for joining HomeworkPal membership. Please verify your email to activate your account and start enjoying exclusive benefits.</p>
                    
                    <div style="text-align: center;">
                        <a href="${verifyUrl}" class="verify-btn">✓ Verify My Email</a>
                    </div>
                    
                    <div class="benefits">
                        <h3>Your Member Benefits:</h3>
                        <div class="benefit">✨ <strong>5% discount</strong> on all orders (increases as you order more!)</div>
                        <div class="benefit">🚀 <strong>Priority support</strong> for faster responses</div>
                        <div class="benefit">💰 <strong>Referral rewards</strong> - earn credits for each friend you refer</div>
                        <div class="benefit">📊 <strong>Order tracking</strong> - monitor all your assignments in one place</div>
                    </div>
                    
                    <p style="color: #666; font-size: 14px;">If you didn't create this account, please ignore this email.</p>
                    <p style="color: #666; font-size: 14px;">This link expires in 24 hours.</p>
                </div>
                <div class="footer">
                    <p>© ${new Date().getFullYear()} HomeworkPal. All rights reserved.</p>
                    <p>Quality academic assistance you can trust.</p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    try {
        await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log(`Verification email sent to ${email}`);
        return true;
    } catch (error) {
        console.error('Failed to send verification email:', error?.body || error);
        return false;
    }
}

// ============ PUBLIC ENDPOINTS ============

// Google Auth endpoint
router.post('/google-auth', async (req, res) => {
    try {
        const { email, name, googleId, photoURL } = req.body;
        
        if (!email || !googleId) {
            return res.status(400).json({ error: 'Invalid Google authentication data' });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Check for disposable email
        if (isDisposableEmail(emailLower)) {
            return res.status(400).json({ 
                error: 'Temporary or disposable email addresses are not allowed.' 
            });
        }
        
        // Check if user exists
        let member;
        const existing = await pool.query(
            'SELECT * FROM client_members WHERE email = $1',
            [emailLower]
        );
        
        if (existing.rows.length > 0) {
            // Existing user - update google_id if not set
            member = existing.rows[0];
            if (!member.google_id) {
                await pool.query(
                    'UPDATE client_members SET google_id = $1, is_verified = TRUE WHERE id = $2',
                    [googleId, member.id]
                );
            }
            // Google users are auto-verified
            if (!member.is_verified) {
                await pool.query('UPDATE client_members SET is_verified = TRUE WHERE id = $1', [member.id]);
            }
            member.is_verified = true;
        } else {
            // Create new user - auto-verified since Google verifies email
            const result = await pool.query(`
                INSERT INTO client_members (email, name, google_id, is_verified, password_hash)
                VALUES ($1, $2, $3, TRUE, $4)
                RETURNING *
            `, [emailLower, name || email.split('@')[0], googleId, 'google-auth-no-password']);
            
            member = result.rows[0];
        }
        
        // Update last login
        await pool.query('UPDATE client_members SET last_login = NOW() WHERE id = $1', [member.id]);
        
        // Generate token
        const token = jwt.sign(
            { memberId: member.id, email: member.email, type: 'client_member' },
            process.env.JWT_SECRET || 'homework-pal-secret',
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            token,
            member: {
                id: member.id,
                email: member.email,
                name: member.name,
                tier: member.membership_tier,
                discount: parseFloat(member.discount_percent),
                isVerified: true,
                totalOrders: member.total_orders || 0,
                totalSpent: parseFloat(member.total_spent || 0)
            }
        });
    } catch (error) {
        console.error('Google auth error:', error);
        res.status(500).json({ error: 'Authentication failed. Please try again.' });
    }
});

// Register as a member
router.post('/register', async (req, res) => {
    try {
        const { email, name, phone, password } = req.body;
        
        if (!email || !name || !password) {
            return res.status(400).json({ error: 'Email, name, and password are required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Check for disposable/temporary email
        if (isDisposableEmail(emailLower)) {
            return res.status(400).json({ 
                error: 'Temporary or disposable email addresses are not allowed. Please use a permanent email address.' 
            });
        }
        
        // Check if already registered
        const existing = await pool.query(
            'SELECT id, is_verified FROM client_members WHERE email = $1',
            [emailLower]
        );
        
        if (existing.rows.length > 0) {
            const existingMember = existing.rows[0];
            if (!existingMember.is_verified) {
                // Resend verification email
                const newToken = crypto.randomBytes(32).toString('hex');
                const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
                
                await pool.query(
                    'UPDATE client_members SET verification_token = $1, token_expiry = $2 WHERE id = $3',
                    [newToken, tokenExpiry, existingMember.id]
                );
                
                await sendVerificationEmail(emailLower, name, newToken);
                
                return res.status(400).json({ 
                    error: 'Email already registered but not verified. We\'ve sent a new verification email.',
                    needsVerification: true 
                });
            }
            return res.status(400).json({ error: 'Email already registered. Please login instead.' });
        }
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Generate verification token with expiry
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        
        // Create member (unverified)
        const result = await pool.query(`
            INSERT INTO client_members (email, name, phone, password_hash, verification_token, token_expiry, is_verified)
            VALUES ($1, $2, $3, $4, $5, $6, FALSE)
            RETURNING id, email, name, membership_tier, discount_percent, created_at
        `, [emailLower, name, phone || null, passwordHash, verificationToken, tokenExpiry]);
        
        const member = result.rows[0];
        
        // Send verification email
        const emailSent = await sendVerificationEmail(emailLower, name, verificationToken);
        
        if (!emailSent) {
            // If email fails, auto-verify as fallback (better UX than blocking)
            await pool.query('UPDATE client_members SET is_verified = TRUE WHERE id = $1', [member.id]);
            
            const token = jwt.sign(
                { memberId: member.id, email: member.email, type: 'client_member' },
                process.env.JWT_SECRET || 'homework-pal-secret',
                { expiresIn: '30d' }
            );
            
            return res.json({
                success: true,
                token,
                member: {
                    id: member.id,
                    email: member.email,
                    name: member.name,
                    tier: member.membership_tier,
                    discount: parseFloat(member.discount_percent)
                },
                message: 'Registration successful! Welcome to HomeworkPal membership.'
            });
        }
        
        res.json({
            success: true,
            needsVerification: true,
            message: `We've sent a verification email to ${emailLower}. Please check your inbox and click the link to activate your account.`
        });
    } catch (error) {
        console.error('Member registration error:', error);
        res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
});

// Login as member
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        const result = await pool.query(
            'SELECT * FROM client_members WHERE email = $1',
            [emailLower]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        const member = result.rows[0];
        
        // Check password
        const validPassword = await bcrypt.compare(password, member.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Check if verified
        if (!member.is_verified) {
            return res.status(403).json({ 
                error: 'Please verify your email before logging in. Check your inbox for the verification link.',
                needsVerification: true
            });
        }
        
        if (member.status !== 'active') {
            return res.status(403).json({ error: 'Account is inactive. Please contact support.' });
        }
        
        // Update last login
        await pool.query('UPDATE client_members SET last_login = NOW() WHERE id = $1', [member.id]);
        
        // Generate token
        const token = jwt.sign(
            { memberId: member.id, email: member.email, type: 'client_member' },
            process.env.JWT_SECRET || 'homework-pal-secret',
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            token,
            member: {
                id: member.id,
                email: member.email,
                name: member.name,
                tier: member.membership_tier,
                discount: parseFloat(member.discount_percent),
                totalOrders: member.total_orders,
                totalSpent: parseFloat(member.total_spent || 0)
            }
        });
    } catch (error) {
        console.error('Member login error:', error);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

// Email verification endpoint
router.get('/verify', async (req, res) => {
    try {
        const { token } = req.query;
        
        if (!token) {
            return res.status(400).send(getVerificationPage('error', 'Invalid verification link.'));
        }
        
        // Find member with this token
        const result = await pool.query(
            'SELECT id, email, name, token_expiry FROM client_members WHERE verification_token = $1',
            [token]
        );
        
        if (result.rows.length === 0) {
            return res.status(400).send(getVerificationPage('error', 'Invalid or expired verification link.'));
        }
        
        const member = result.rows[0];
        
        // Check if token expired
        if (member.token_expiry && new Date(member.token_expiry) < new Date()) {
            return res.status(400).send(getVerificationPage('expired', 'Verification link has expired. Please register again or request a new verification email.'));
        }
        
        // Verify the member
        await pool.query(`
            UPDATE client_members 
            SET is_verified = TRUE, verification_token = NULL, token_expiry = NULL 
            WHERE id = $1
        `, [member.id]);
        
        console.log(`Member verified: ${member.email}`);
        
        res.send(getVerificationPage('success', `Welcome to HomeworkPal, ${member.name}! Your email has been verified.`));
    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).send(getVerificationPage('error', 'Verification failed. Please try again.'));
    }
});

// Resend verification email
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        const result = await pool.query(
            'SELECT id, name, is_verified FROM client_members WHERE email = $1',
            [emailLower]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No account found with this email' });
        }
        
        const member = result.rows[0];
        
        if (member.is_verified) {
            return res.status(400).json({ error: 'Email is already verified. You can login now.' });
        }
        
        // Generate new token
        const newToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        
        await pool.query(
            'UPDATE client_members SET verification_token = $1, token_expiry = $2 WHERE id = $3',
            [newToken, tokenExpiry, member.id]
        );
        
        const emailSent = await sendVerificationEmail(emailLower, member.name, newToken);
        
        if (!emailSent) {
            return res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
        }
        
        res.json({
            success: true,
            message: 'Verification email sent! Please check your inbox.'
        });
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ error: 'Failed to resend verification email.' });
    }
});

// Helper function for verification page HTML
function getVerificationPage(status, message) {
    const statusConfig = {
        success: { icon: '✓', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.1)' },
        error: { icon: '✗', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)' },
        expired: { icon: '⏰', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)' }
    };
    
    const config = statusConfig[status] || statusConfig.error;
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Email Verification - HomeworkPal</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: 'Segoe UI', Arial, sans-serif; 
                    background: linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .container {
                    background: rgba(255,255,255,0.05);
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 20px;
                    padding: 40px;
                    max-width: 500px;
                    text-align: center;
                }
                .icon {
                    width: 80px;
                    height: 80px;
                    border-radius: 50%;
                    background: ${config.bgColor};
                    color: ${config.color};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 40px;
                    margin: 0 auto 20px;
                }
                h1 { color: white; margin-bottom: 15px; font-size: 24px; }
                p { color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 25px; }
                .btn {
                    display: inline-block;
                    background: linear-gradient(135deg, #6366f1, #8b5cf6);
                    color: white;
                    padding: 12px 30px;
                    border-radius: 8px;
                    text-decoration: none;
                    font-weight: 600;
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(99,102,241,0.3); }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">${config.icon}</div>
                <h1>${status === 'success' ? 'Email Verified!' : status === 'expired' ? 'Link Expired' : 'Verification Failed'}</h1>
                <p>${message}</p>
                <a href="${process.env.BASE_URL || 'https://www.homeworkpal.online'}/client.html#membership" class="btn">
                    ${status === 'success' ? 'Login to Your Account' : 'Back to Homepage'}
                </a>
            </div>
        </body>
        </html>
    `;
}

// Get membership tiers (public)
router.get('/tiers', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT name, min_orders, min_spent, discount_percent, perks
            FROM membership_tiers
            ORDER BY min_orders ASC
        `);
        
        res.json(result.rows.map(tier => ({
            name: tier.name,
            minOrders: tier.min_orders,
            minSpent: parseFloat(tier.min_spent),
            discount: parseFloat(tier.discount_percent),
            perks: tier.perks ? tier.perks.split(', ') : []
        })));
    } catch (error) {
        console.error('Get tiers error:', error);
        res.status(500).json({ error: 'Failed to fetch tiers' });
    }
});

// Middleware to verify member token
function authenticateMember(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'homework-pal-secret');
        if (decoded.type !== 'client_member') {
            return res.status(403).json({ error: 'Invalid token type' });
        }
        req.member = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Get member profile
router.get('/profile', authenticateMember, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT cm.*, mt.perks
            FROM client_members cm
            LEFT JOIN membership_tiers mt ON cm.membership_tier = mt.name
            WHERE cm.id = $1
        `, [req.member.memberId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        const member = result.rows[0];
        
        // Get next tier info
        const nextTier = await pool.query(`
            SELECT * FROM membership_tiers
            WHERE min_orders > $1 OR min_spent > $2
            ORDER BY min_orders ASC
            LIMIT 1
        `, [member.total_orders, member.total_spent || 0]);
        
        res.json({
            member: {
                id: member.id,
                email: member.email,
                name: member.name,
                phone: member.phone,
                membership_tier: member.membership_tier,
                discount_percent: parseFloat(member.discount_percent),
                total_orders: member.total_orders,
                total_spent: parseFloat(member.total_spent || 0),
                is_verified: member.is_verified,
                perks: member.perks ? member.perks.split(', ') : [],
                memberSince: member.created_at,
                nextTier: nextTier.rows[0] ? {
                    name: nextTier.rows[0].name,
                    ordersNeeded: nextTier.rows[0].min_orders - member.total_orders,
                    spentNeeded: parseFloat(nextTier.rows[0].min_spent) - parseFloat(member.total_spent || 0),
                    discount: parseFloat(nextTier.rows[0].discount_percent)
                } : null
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Update member stats (called after order completion - internal use)
router.post('/update-stats', async (req, res) => {
    try {
        const { email, orderAmount } = req.body;
        
        if (!email) {
            return res.json({ updated: false });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Get current member
        const member = await pool.query(
            'SELECT * FROM client_members WHERE email = $1',
            [emailLower]
        );
        
        if (member.rows.length === 0) {
            return res.json({ updated: false, reason: 'Not a member' });
        }
        
        const m = member.rows[0];
        const newOrderCount = m.total_orders + 1;
        const newTotalSpent = parseFloat(m.total_spent || 0) + parseFloat(orderAmount || 0);
        
        // Check for tier upgrade
        const newTier = await pool.query(`
            SELECT * FROM membership_tiers
            WHERE min_orders <= $1 AND min_spent <= $2
            ORDER BY discount_percent DESC
            LIMIT 1
        `, [newOrderCount, newTotalSpent]);
        
        const tierName = newTier.rows[0]?.name || 'basic';
        const discount = newTier.rows[0]?.discount_percent || 5;
        
        // Auto-verify members who have completed orders (they've proven they're real customers)
        const shouldAutoVerify = newOrderCount >= 1;
        
        // Update member (auto-verify if they have orders)
        await pool.query(`
            UPDATE client_members
            SET total_orders = $1, total_spent = $2, membership_tier = $3, discount_percent = $4,
                is_verified = CASE WHEN $6 THEN TRUE ELSE is_verified END
            WHERE id = $5
        `, [newOrderCount, newTotalSpent, tierName, discount, m.id, shouldAutoVerify]);
        
        const upgraded = tierName !== m.membership_tier;
        
        res.json({
            updated: true,
            newTier: tierName,
            newDiscount: parseFloat(discount),
            upgraded,
            totalOrders: newOrderCount,
            totalSpent: newTotalSpent,
            autoVerified: shouldAutoVerify && !m.is_verified
        });
    } catch (error) {
        console.error('Update member stats error:', error);
        res.status(500).json({ error: 'Failed to update stats' });
    }
});

// Get member discount for an email (used during checkout) - only returns discount if verified
router.get('/discount/:email', async (req, res) => {
    try {
        const emailLower = req.params.email.toLowerCase().trim();
        
        const result = await pool.query(
            'SELECT discount_percent, membership_tier, is_verified FROM client_members WHERE email = $1 AND status = $2',
            [emailLower, 'active']
        );
        
        if (result.rows.length === 0) {
            return res.json({ isMember: false, discount: 0 });
        }
        
        const member = result.rows[0];
        
        // Only return discount if member is verified
        if (!member.is_verified) {
            return res.json({ 
                isMember: true, 
                discount: 0, 
                tier: member.membership_tier,
                message: 'Please verify your email to unlock your discount'
            });
        }
        
        res.json({
            isMember: true,
            tier: member.membership_tier,
            discount: parseFloat(member.discount_percent)
        });
    } catch (error) {
        console.error('Get discount error:', error);
        res.json({ isMember: false, discount: 0 });
    }
});

// ============ ADMIN ENDPOINTS ============

// Get all members (admin view)
router.get('/admin/list', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                id, email, name, phone, membership_tier, discount_percent,
                total_orders, total_spent, is_verified, status, created_at
            FROM client_members
            ORDER BY created_at DESC
        `);
        
        // Calculate stats
        const members = result.rows;
        const stats = {
            total: members.length,
            basic: members.filter(m => m.membership_tier === 'basic').length,
            silver: members.filter(m => m.membership_tier === 'silver').length,
            goldPlus: members.filter(m => ['gold', 'platinum'].includes(m.membership_tier)).length
        };
        
        res.json({
            members: members.map(m => ({
                id: m.id,
                email: m.email,
                name: m.name,
                phone: m.phone,
                tier: m.membership_tier,
                discount: parseFloat(m.discount_percent),
                orders: m.total_orders || 0,
                totalSpent: parseFloat(m.total_spent || 0),
                verified: m.is_verified,
                status: m.status,
                joinedAt: m.created_at
            })),
            stats
        });
    } catch (error) {
        console.error('Get members list error:', error);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

module.exports = router;
