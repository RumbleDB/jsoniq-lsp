package org.jsoniq.lsp.rumble;

import org.rumbledb.compiler.VisitorHelpers;
import org.rumbledb.config.RumbleRuntimeConfiguration;
import org.rumbledb.context.Name;
import org.rumbledb.context.StaticContext;
import org.rumbledb.exceptions.ExceptionMetadata;
import org.rumbledb.exceptions.UnexpectedStaticTypeException;
import org.rumbledb.expressions.Node;
import org.rumbledb.expressions.flowr.Clause;
import org.rumbledb.expressions.flowr.CountClause;
import org.rumbledb.expressions.flowr.ForClause;
import org.rumbledb.expressions.flowr.GroupByClause;
import org.rumbledb.expressions.flowr.GroupByVariableDeclaration;
import org.rumbledb.expressions.flowr.LetClause;
import org.rumbledb.expressions.module.FunctionDeclaration;
import org.rumbledb.expressions.module.MainModule;
import org.rumbledb.expressions.module.VariableDeclaration;
import org.rumbledb.expressions.primary.InlineFunctionExpression;
import org.rumbledb.types.SequenceType;

import com.fasterxml.jackson.annotation.JsonValue;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class TypeInferencer implements RequestHandler {
    public static final Comparator<Position> POSITION_COMPARATOR = Comparator
            .comparingInt(Position::line)
            .thenComparingInt(Position::character);

    public record Position(int line, int character) {
    }

    public enum VariableKind {
        Declare("declare-variable"),
        Let("let"),
        For("for"),
        ForPosition("for-position"),
        GroupBy("group-by"),
        Count("count");

        private final String value;

        private VariableKind(String value) {
            this.value = value;
        }

        @Override
        @JsonValue
        public String toString() {
            return this.value;
        }
    }

    /**
     * Represents the type of a variable.
     * 
     * @param line      the line number of the variable declaration
     * @param character the column number of the variable declaration
     * @param name      the name of the variable
     * @param type      the inferred type of the variable
     * @param kind      the kind of AST node that declares the variable (e.g.,
     *                  "ForVariableDeclaration", "LetVariableDeclaration", etc.)
     */
    public record VariableType(
            Position position,
            String name,
            String type,
            VariableKind kind) {
    }

    /**
     * Represents the type of a function.
     * 
     * @param line           the line number of the function declaration
     * @param character      the column number of the function declaration
     * @param name           the name of the function
     * @param parameterTypes a map of parameter names to their types
     * @param returnType     the return type of the function
     */
    public record FunctionType(
            Position position,
            String name,
            Map<String, String> parameterTypes,
            String returnType) {
    }

    public record TypeError(
            String code,
            String message,
            String location,
            Position position) {
    }

    public record Result(
            List<VariableType> variableTypes,
            List<FunctionType> functionTypes,
            List<TypeError> typeErrors) implements ResponseBody {
    }

    public final static Result EMPTY_RESULT = new Result(List.of(), List.of(), List.of());

    private final RumbleRuntimeConfiguration permissiveConfiguration;
    private final RumbleRuntimeConfiguration strictConfiguration;

    public TypeInferencer() {
        /**
         * We need two separate configuration because when static typing is enabled, the
         * parser will throw an exception as soon as it encounters a type error, which
         * prevents us from collecting available type information for the rest of the
         * query.
         * 
         * So we first parse the query with a permissive configuration (without static
         * typing) to collect as much type information as possible, and then we parse it
         * again with a strict configuration (with static typing) to collect type
         * errors.
         */
        this.permissiveConfiguration = new RumbleRuntimeConfiguration();

        String[] withStaticTyping = { "--static-typing", "yes" };
        this.strictConfiguration = new RumbleRuntimeConfiguration(withStaticTyping);
    }

    public Result infer(String query) {
        if (query == null || query.isEmpty()) {
            return EMPTY_RESULT;
        }

        List<VariableType> variableTypes = new ArrayList<>();
        List<FunctionType> functionTypes = new ArrayList<>();
        List<TypeError> typeErrors = new ArrayList<>();

        try {
            MainModule module = VisitorHelpers.parseMainModuleFromQuery(query, this.permissiveConfiguration);
            visitNodeAndCollectTypes(module, variableTypes, functionTypes);
            variableTypes.sort((v1, v2) -> POSITION_COMPARATOR.compare(v1.position(), v2.position()));
            functionTypes.sort((f1, f2) -> POSITION_COMPARATOR.compare(f1.position(), f2.position()));
        } catch (Throwable throwable) {
            /// Because we are using the permissive configuration, the only kind of error we
            /// expect here are parsing errors
            /// We already have parsing error report from Typescript parser, so we don't
            /// need these information
        }

        /// Parse with strict configuration to collect type errors, if any.
        try {
            VisitorHelpers.parseMainModuleFromQuery(query, this.strictConfiguration);
        } catch (UnexpectedStaticTypeException exception) {
            typeErrors.add(toTypeError(exception));
        }

        return new Result(variableTypes, functionTypes, typeErrors);
    }

    private static TypeError toTypeError(UnexpectedStaticTypeException exception) {
        ExceptionMetadata metadata = exception.getMetadata() == null
                ? ExceptionMetadata.EMPTY_METADATA
                : exception.getMetadata();
        String code = exception.getErrorCode();
        String message = Objects.toString(exception.getJSONiqErrorMessage(), exception.getMessage());
        return new TypeError(
                code,
                message,
                metadata.getLocation(),
                createPosition(metadata));
    }

    /**
     * Creates a Position object from the given exception metadata.
     * 
     * Note: in language server, the type Position.line uses uinteger type, and
     * starts from 0,
     * while in Rumble ExceptionMetadata, the line number starts from 1, that's why
     * 1 is subtracted from the line number to make it uniform.
     * 
     * @param metadata the exception metadata to create the position from
     * @return a Position object representing the position of the error in the
     *         source code
     */
    private static Position createPosition(ExceptionMetadata metadata) {
        int line = Math.max(0, metadata.getTokenLineNumber() - 1);
        int column = Math.max(0, metadata.getTokenColumnNumber());
        return new Position(line, column);
    }

    /**
     * Recursively visits the AST nodes and collects variable and function types.
     * 
     * @param node          the current AST node being visited
     * @param variableTypes the list to collect variable types into
     * @param functionTypes the list to collect function types into
     */
    private static void visitNodeAndCollectTypes(
            Node node,
            List<VariableType> variableTypes,
            List<FunctionType> functionTypes) {
        if (node == null) {
            return;
        }

        collectFunctionType(node, variableTypes, functionTypes);
        collectVariableType(node, variableTypes);

        for (Node child : node.getChildren()) {
            visitNodeAndCollectTypes(child, variableTypes, functionTypes);
        }
    }

    /**
     * Collects function type from the given AST node if it declares a function
     * 
     * @param node          the AST node to check for function declarations
     * @param functionTypes the list to collect function types into
     */
    private static void collectFunctionType(
            Node node,
            List<VariableType> variableTypes,
            List<FunctionType> functionTypes) {
        if (!(node instanceof FunctionDeclaration functionDeclaration)) {
            return;
        }

        if (!(functionDeclaration.getExpression() instanceof InlineFunctionExpression functionExpression)) {
            return;
        }

        ExceptionMetadata metadata = functionDeclaration.getMetadata();
        if (metadata == null) {
            return;
        }

        Map<String, String> parameterTypes = new LinkedHashMap<>();
        functionExpression.getParams().forEach((name, type) -> {
            /// I don't add parameters to variable list because we don't have the exact
            /// position of the parameters in the metadata (the metadata only contains the
            /// start position of the function declaration)
            /// But because parameter names are unique within a function, we can still
            /// identify them first by function and then by parameter name
            /// In our LSP, we do have exact position for parameters, so we can complete the
            /// position information for parameters there.
            String parameterName = name.getLocalName() == null ? name.toString() : name.getLocalName();
            String parameterType = type == null ? "item*" : type.toString();
            parameterTypes.put("$" + parameterName, parameterType);
        });

        SequenceType returnType = functionExpression.getReturnType();
        if (returnType == null) {
            returnType = SequenceType.createSequenceType("item*");
        }

        functionTypes.add(new FunctionType(
                createPosition(metadata),
                functionDeclaration.getFunctionIdentifier().getName().toString(),
                parameterTypes,
                returnType.toString()));
    }

    /**
     * Collects variable types from the given AST node if it declares variables
     * 
     * @param node          the AST node to check for variable declarations
     * @param variableTypes the list to collect variable types into
     */
    private static void collectVariableType(
            Node node,
            List<VariableType> variableTypes) {
        if (node instanceof VariableDeclaration variableDeclaration) {
            /// Global variable declaration does not Clause type, we need to handle it
            /// separately
            addDeclaredVariableType(variableDeclaration, variableTypes);
            return;
        }

        if (!(node instanceof Clause clause)) {
            return;
        }

        /// Note: we are moving to the next clause's static context because that's where
        /// the current clause's variables are in scope.
        // If we stay in the current clause's static context, we won't find the
        /// variables because they haven't been added to the static context yet.
        StaticContext typeContext = clause.getNextClause() != null
                ? clause.getNextClause().getStaticContext()
                : clause.getStaticContext();

        if (typeContext == null) {
            return;
        }

        if (clause instanceof ForClause forClause) {
            addVariableTypeFromContext(
                    typeContext,
                    forClause.getVariableName(),
                    VariableKind.For,
                    variableTypes);

            // Positional variable is optional, so we check if it exists before trying to
            // add its type
            Name positionalVariableName = forClause.getPositionalVariableName();
            if (positionalVariableName != null) {
                addVariableTypeFromContext(
                        typeContext,
                        positionalVariableName,
                        VariableKind.ForPosition,
                        variableTypes);
            }
            return;
        }

        if (clause instanceof LetClause letClause) {
            addVariableTypeFromContext(
                    typeContext,
                    letClause.getVariableName(),
                    VariableKind.Let,
                    variableTypes);
            return;
        }

        if (clause instanceof CountClause countClause) {
            addVariableTypeFromContext(
                    typeContext,
                    countClause.getCountVariableName(),
                    VariableKind.Count,
                    variableTypes);
            return;
        }

        if (clause instanceof GroupByClause groupByClause) {
            for (GroupByVariableDeclaration groupByVariable : groupByClause.getGroupVariables()) {
                addVariableTypeFromContext(
                        typeContext,
                        groupByVariable.getVariableName(),
                        VariableKind.GroupBy,
                        variableTypes);
            }
        }
    }

    private static void addDeclaredVariableType(
            VariableDeclaration variableDeclaration,
            List<VariableType> variableTypes) {
        Name variableName = variableDeclaration.getVariableName();
        ExceptionMetadata metadata = variableDeclaration.getMetadata();
        if (variableName == null || metadata == null) {
            return;
        }

        SequenceType variableType = variableDeclaration.getSequenceType();
        variableTypes.add(new VariableType(
                createPosition(metadata),
                variableName.toString(),
                variableType.toString(),
                VariableKind.Declare));
    }

    /**
     * Adds a variable type to the list of variable types based on the static
     * context and variable name.
     * 
     * @param context       the static context to retrieve the variable type from
     * @param variableName  the name of the variable to retrieve the type for
     * @param kind          the kind of AST node that declares the variable (e.g.,
     *                      "ForVariableDeclaration")
     * @param variableTypes the list to add the variable type to
     * @return true if the variable type was successfully added, false otherwise
     */
    private static boolean addVariableTypeFromContext(
            StaticContext context,
            Name variableName,
            VariableKind kind,
            List<VariableType> variableTypes) {
        if (context == null || variableName == null) {
            return false;
        }

        try {
            SequenceType variableType = context.getVariableSequenceType(variableName);
            ExceptionMetadata metadata = context.getVariableMetadata(variableName);
            variableTypes
                    .add(new VariableType(createPosition(metadata), variableName.toString(), variableType.toString(),
                            kind));
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    @Override
    public ResponseBody handle(Request request) {
        if (request.body() == null) {
            throw new IllegalArgumentException("Request body is null.");
        }

        byte[] decodedBytes = Base64.getDecoder().decode(request.body());
        String query = new String(decodedBytes, StandardCharsets.UTF_8);
        return infer(query);
    }

    @Override
    public ResponseBody createEmptyResponse() {
        return EMPTY_RESULT;
    }
}
