package inveos.research;

// First-party bounded research wrapper. Upstream parser code remains in the ignored source cache.
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import org.apache.tika.extractor.EmbeddedDocumentExtractor;
import org.apache.tika.io.TikaInputStream;
import org.apache.tika.metadata.Metadata;
import org.apache.tika.parser.ParseContext;
import org.apache.tika.parser.pages.TextPolicy;
import org.apache.tika.parser.pdf.PDFParser;
import org.apache.tika.parser.pdf.PDFParserConfig;
import org.apache.tika.sax.ToXMLContentHandler;
import org.apache.tika.sax.WriteOutContentHandler;
import org.xml.sax.ContentHandler;

public final class TikaPdfProbe {
    private static String hash(byte[] data) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
    }
    private static String quoted(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\\' || c == '"') out.append('\\').append(c);
            else if (c < 32) out.append(String.format("\\u%04x", (int)c));
            else out.append(c);
        }
        return out.append('"').toString();
    }
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("One fictional input path required");
        Path path = Path.of(args[0]);
        long size = Files.size(path);
        if (size < 8 || size > 2097152) throw new IllegalArgumentException("Input byte bound");
        byte[] original = Files.readAllBytes(path);
        if (!new String(original, 0, 5, StandardCharsets.US_ASCII).equals("%PDF-")) throw new IllegalArgumentException("PDF signature required");
        PDFParserConfig config = new PDFParserConfig();
        config.pages().setText(TextPolicy.EXTRACT);
        config.pages().emit().setEnabled(false);
        config.setExtractInlineImages(false);
        config.setExtractAcroFormContent(false);
        config.setExtractBookmarksText(false);
        config.setExtractAnnotationText(false);
        config.setExtractActions(false);
        config.setMaxMainMemoryBytes(33554432);
        config.setMaxPages(16);
        ParseContext context = new ParseContext();
        context.set(PDFParserConfig.class, config);
        context.set(EmbeddedDocumentExtractor.class, new EmbeddedDocumentExtractor() {
            public boolean shouldParseEmbedded(Metadata metadata, ParseContext scope) { return false; }
            public void parseEmbedded(TikaInputStream stream, ContentHandler handler, Metadata metadata, ParseContext scope, boolean outputHtml) {
                throw new IllegalStateException("Embedded parsing is disabled");
            }
        });
        Metadata metadata = new Metadata();
        ToXMLContentHandler xml = new ToXMLContentHandler("UTF-8");
        long cpuStarted = ProcessHandle.current().info().totalCpuDuration().orElseThrow().toNanos();
        long started = System.nanoTime();
        try (TikaInputStream input = TikaInputStream.get(path, metadata)) {
            new PDFParser().parse(input, new WriteOutContentHandler(xml, 262144), metadata, context);
        }
        long elapsed = System.nanoTime() - started;
        long cpuElapsed = ProcessHandle.current().info().totalCpuDuration().orElseThrow().toNanos() - cpuStarted;
        long peakRssKiB = 0;
        for (String line : Files.readAllLines(Path.of("/proc/self/status"))) {
            if (line.startsWith("VmHWM:")) peakRssKiB = Long.parseLong(line.trim().split("\\s+")[1]);
        }
        byte[] output = xml.toString().getBytes(StandardCharsets.UTF_8);
        if (output.length > 1048576 || !Arrays.equals(original, Files.readAllBytes(path))) throw new IllegalStateException("Output bound or original changed");
        StringBuilder fields = new StringBuilder("{");
        String[] names = metadata.names();
        Arrays.sort(names);
        if (names.length > 1000) throw new IllegalStateException("Metadata field bound");
        for (String name : names) {
            if (fields.length() > 1) fields.append(',');
            fields.append(quoted(name)).append(":[");
            String[] values = metadata.getValues(name);
            for (int i = 0; i < values.length; i++) {
                if (i > 0) fields.append(',');
                fields.append(quoted(values[i]));
            }
            fields.append(']');
            if (fields.length() > 262144) throw new IllegalStateException("Metadata character bound");
        }
        fields.append('}');
        System.out.println("{\"format\":\"inveos_tika_research_probe_v1\",\"sourceSha256\":" + quoted(hash(original)) + ",\"xhtmlSha256\":" + quoted(hash(output)) + ",\"xhtmlBase64\":" + quoted(Base64.getEncoder().encodeToString(output)) + ",\"parseNanos\":" + elapsed + ",\"processCpuNanos\":" + cpuElapsed + ",\"peakRssKiB\":" + peakRssKiB + ",\"metadata\":" + fields + ",\"state\":\"unreviewed_research_derivative\"}");
    }
}
