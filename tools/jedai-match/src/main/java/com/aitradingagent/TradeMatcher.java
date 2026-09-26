package com.aitradingagent;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.scify.jedai.datamodel.Attribute;
import org.scify.jedai.datamodel.EntityProfile;
import org.scify.jedai.datareader.entityreader.EntityCSVReader;

/**
 * TradeMatcher -- finds likely-duplicate records between two CSV files.
 * Built 2026-09-26 for F:\aitradingagent's trade-ledger integrity checks
 * (see pom.xml header for the full "why").
 *
 * HONESTY NOTE (so this isn't an "undocumented" black box): this was
 * originally written to also do the similarity SCORING through JedAI's
 * own ProfileMatcher class. Live-tested and found broken -- JedAI 3.2 and
 * 3.2.1 (the only two versions that actually resolve from Maven Central;
 * 2.0 and 3.0 fail to build at all here because of a dead custom-repo
 * transitive dependency) both throw a NullPointerException from inside
 * ProfileMatcher's own parent-class constructor
 * (RepModelSimMetricCombo.getAllValidCombos, "metrics is null") for EVERY
 * representation-model/similarity-metric combination -- a genuine bug in
 * the library itself, not a mistake in how it was called here (confirmed
 * against JedAI's own verified example code before concluding this).
 *
 * So JedAI is still doing real work here -- EntityCSVReader, the actual
 * JedAI library class, reads both CSVs into EntityProfile objects -- but
 * the final similarity SCORE is a plain, transparent, hand-written
 * character-trigram Jaccard comparison over each record's full attribute
 * text, since JedAI's own scorer cannot currently be called at all. This
 * is a simple, well-understood, no-black-box algorithm: it treats two
 * records as similar if their attribute text shares many overlapping
 * 3-character sequences (catches near-duplicate values with tiny
 * differences -- e.g. a price rounded slightly differently -- the same
 * kind of thing ProfileMatcher would have measured).
 *
 * Usage:
 *   java -jar jedai-match.jar <csv1> <csv2> <outputCsv> [threshold]
 *
 * csv1/csv2 must have a header row, comma-separated, with a unique row id
 * as the FIRST column (scripts\export_ledger_to_csv.py produces this
 * shape from the JSON ledger files). threshold is a similarity score
 * 0.0-1.0 (default 0.5) -- pairs scoring at or above it are written to
 * outputCsv for a human to review. This tool only REPORTS candidate
 * duplicates; it never deletes, merges or edits any trade record itself.
 */
public class TradeMatcher {

    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("Usage: java -jar jedai-match.jar <csv1> <csv2> <outputCsv> [threshold]");
            System.exit(1);
        }
        String csv1 = args[0];
        String csv2 = args[1];
        String outputCsv = args[2];
        double threshold = args.length >= 4 ? Double.parseDouble(args[3]) : 0.65;

        List<EntityProfile> profiles1 = loadCsv(csv1);
        List<EntityProfile> profiles2 = loadCsv(csv2);
        System.out.println("Loaded " + profiles1.size() + " rows from " + csv1);
        System.out.println("Loaded " + profiles2.size() + " rows from " + csv2);

        int matches = 0;
        try (PrintWriter out = new PrintWriter(new FileWriter(outputCsv))) {
            out.println("similarity,csv1_id,csv2_id,csv1_summary,csv2_summary");
            for (EntityProfile p1 : profiles1) {
                Set<String> trigrams1 = trigramsOf(summarize(p1));
                for (EntityProfile p2 : profiles2) {
                    double sim = jaccard(trigrams1, trigramsOf(summarize(p2)));
                    if (sim >= threshold) {
                        out.println(round(sim) + ",\"" + p1.getEntityUrl() + "\",\"" + p2.getEntityUrl()
                                + "\",\"" + summarize(p1) + "\",\"" + summarize(p2) + "\"");
                        matches++;
                    }
                }
            }
        }
        System.out.println("Compared " + (profiles1.size() * (long) profiles2.size())
                + " candidate pairs, " + matches + " scored >= " + threshold
                + " -- written to " + outputCsv);
    }

    private static List<EntityProfile> loadCsv(String path) {
        EntityCSVReader reader = new EntityCSVReader(path);
        reader.setAttributeNamesInFirstRow(true);
        reader.setSeparator(',');
        reader.setIdIndex(0);
        return reader.getEntityProfiles();
    }

    private static String summarize(EntityProfile p) {
        StringBuilder sb = new StringBuilder();
        for (Attribute a : p.getAttributes()) {
            sb.append(a.getName()).append('=').append(a.getValue()).append(" | ");
        }
        return sb.toString();
    }

    private static Set<String> trigramsOf(String text) {
        String t = text.toLowerCase().replaceAll("\\s+", " ").trim();
        Set<String> grams = new HashSet<>();
        for (int i = 0; i + 3 <= t.length(); i++) {
            grams.add(t.substring(i, i + 3));
        }
        return grams;
    }

    private static double jaccard(Set<String> a, Set<String> b) {
        if (a.isEmpty() && b.isEmpty()) return 0.0;
        Set<String> intersection = new HashSet<>(a);
        intersection.retainAll(b);
        Set<String> union = new HashSet<>(a);
        union.addAll(b);
        return union.isEmpty() ? 0.0 : (double) intersection.size() / union.size();
    }

    private static double round(double v) {
        return Math.round(v * 1000.0) / 1000.0;
    }
}
