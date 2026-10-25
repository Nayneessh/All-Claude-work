import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;

import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Minimal APK signer/verifier built on Android's apksig library (v2 scheme; minSdk 24).
 * Passwords are read from environment variables so they never appear in process listings or logs.
 *
 *   sign   <in.apk> <out.apk> <keystore> <alias>   (env: MG_KEYSTORE_PASSWORD, MG_KEY_PASSWORD)
 *   verify <apk>
 */
public class ApkSign {
    public static void main(String[] args) throws Exception {
        if (args.length >= 1 && args[0].equals("verify")) {
            ApkVerifier.Result r = new ApkVerifier.Builder(new File(args[1])).build().verify();
            System.out.println("verified=" + r.isVerified() + " v1=" + r.isVerifiedUsingV1Scheme() + " v2=" + r.isVerifiedUsingV2Scheme());
            for (ApkVerifier.IssueWithParams e : r.getErrors()) System.out.println("ERROR: " + e);
            for (ApkVerifier.IssueWithParams w : r.getWarnings()) System.out.println("WARN: " + w);
            for (X509Certificate c : r.getSignerCertificates()) System.out.println("cert sha256=" + sha256(c.getEncoded()) + " subject=" + c.getSubjectX500Principal());
            System.exit(r.isVerified() ? 0 : 1);
        }
        if (args.length == 5 && args[0].equals("sign")) {
            String storePass = System.getenv("MG_KEYSTORE_PASSWORD");
            String keyPass = System.getenv("MG_KEY_PASSWORD");
            if (storePass == null || keyPass == null) throw new IllegalStateException("MG_KEYSTORE_PASSWORD / MG_KEY_PASSWORD not set");
            KeyStore ks = KeyStore.getInstance("PKCS12");
            try (FileInputStream in = new FileInputStream(args[3])) { ks.load(in, storePass.toCharArray()); }
            PrivateKey key = (PrivateKey) ks.getKey(args[4], keyPass.toCharArray());
            List<X509Certificate> chain = new ArrayList<>();
            Collections.addAll(chain, java.util.Arrays.copyOf(ks.getCertificateChain(args[4]), ks.getCertificateChain(args[4]).length, X509Certificate[].class));
            ApkSigner.SignerConfig cfg = new ApkSigner.SignerConfig.Builder("monstergains", key, chain).build();
            new ApkSigner.Builder(Collections.singletonList(cfg))
                .setInputApk(new File(args[1]))
                .setOutputApk(new File(args[2]))
                .setMinSdkVersion(24)
                .setV1SigningEnabled(false) // minSdk >= 24: v2 is sufficient (and apksig 2.3.0 v1 needs JDK8 internals)
                .setV2SigningEnabled(true)
                .build()
                .sign();
            System.out.println("signed " + args[2]);
            return;
        }
        System.err.println("usage: sign <in> <out> <keystore> <alias> | verify <apk>");
        System.exit(2);
    }

    private static String sha256(byte[] b) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (byte x : MessageDigest.getInstance("SHA-256").digest(b)) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
