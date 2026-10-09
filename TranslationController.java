package com.smarttranslator;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * POST /api/translate
 *
 * Request : {"text": "Hello", "source": "en" | "auto", "target": "hi"}
 * Response: {"translatedText": "...", "detectedSource": "en"}   (detectedSource is null unless source = auto)
 * Errors  : {"error": "human readable message"}
 *
 * The Google API key is read from the GOOGLE_TRANSLATE_API_KEY environment variable
 * and is never sent to the browser.
 */
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "${app.cors.allowed-origins}")
public class TranslationController {

    private static final String LANG_PATTERN = "^(auto|[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?)$";

    private final RestClient google;
    private final String apiKey;

    public TranslationController(@Value("${GOOGLE_TRANSLATE_API_KEY:}") String apiKey) {
        this.apiKey = apiKey;
        this.google = RestClient.builder()
                .baseUrl("https://translation.googleapis.com")
                .build();
    }

    public record TranslateRequest(
            @NotBlank(message = "Text must not be empty.")
            @Size(max = 5000, message = "Text must be 5000 characters or fewer.")
            String text,

            @Pattern(regexp = LANG_PATTERN, message = "Source language code is invalid.")
            String source,

            @NotBlank(message = "Target language is required.")
            @Pattern(regexp = LANG_PATTERN, message = "Target language code is invalid.")
            String target) {
    }

    public record TranslateResponse(String translatedText, String detectedSource) {
    }

    /** Shape of Google Cloud Translation v2 responses (only the fields we use). */
    record GoogleResponse(Data data) {
        record Data(List<Translation> translations) {
        }

        record Translation(String translatedText, String detectedSourceLanguage) {
        }
    }

    @PostMapping(value = "/translate", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> translate(@Valid @RequestBody TranslateRequest request) {
        if (apiKey.isBlank()) {
            return error(HttpStatus.SERVICE_UNAVAILABLE,
                    "The server has no translation API key. Set the GOOGLE_TRANSLATE_API_KEY environment variable and restart.");
        }
        if ("auto".equalsIgnoreCase(request.target())) {
            return error(HttpStatus.BAD_REQUEST, "Target language cannot be 'auto'.");
        }

        boolean autoDetect = request.source() == null
                || request.source().isBlank()
                || "auto".equalsIgnoreCase(request.source());

        Map<String, Object> body = new HashMap<>();
        body.put("q", request.text());
        body.put("target", request.target());
        body.put("format", "text");
        if (!autoDetect) {
            body.put("source", request.source());
        }

        try {
            GoogleResponse response = google.post()
                    .uri("/language/translate/v2")
                    .header("X-goog-api-key", apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(GoogleResponse.class);

            if (response == null || response.data() == null
                    || response.data().translations() == null
                    || response.data().translations().isEmpty()) {
                return error(HttpStatus.BAD_GATEWAY, "The translation service returned an empty response.");
            }

            GoogleResponse.Translation t = response.data().translations().get(0);
            String detected = autoDetect ? t.detectedSourceLanguage() : null;
            return ResponseEntity.ok(new TranslateResponse(t.translatedText(), detected));

        } catch (RestClientResponseException e) {
            int status = e.getStatusCode().value();
            if (status == 429) {
                return error(HttpStatus.TOO_MANY_REQUESTS, "Translation quota exceeded. Try again later.");
            }
            if (status == 400 || status == 403) {
                return error(HttpStatus.BAD_GATEWAY,
                        "Google rejected the request. Check that the API key is valid and the Cloud Translation API is enabled.");
            }
            return error(HttpStatus.BAD_GATEWAY, "The translation service failed (HTTP " + status + ").");
        } catch (ResourceAccessException e) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "Could not reach the translation service. Try again shortly.");
        }
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> handleValidation(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .findFirst()
                .orElse("Invalid request.");
        return ResponseEntity.badRequest().body(Map.of("error", message));
    }

    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, String>> handleUnreadable() {
        return ResponseEntity.badRequest().body(Map.of("error", "Request body must be valid JSON."));
    }

    private static ResponseEntity<Map<String, String>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of("error", message));
    }
}
