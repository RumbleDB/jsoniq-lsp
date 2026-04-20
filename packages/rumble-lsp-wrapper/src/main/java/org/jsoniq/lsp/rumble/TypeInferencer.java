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

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class TypeInferencer {
    public static final Comparator<Position> POSITION_COMPARATOR = Comparator
            .comparingInt(Position::line)
            .thenComparingInt(Position::character);

    public record Position(int line, int character) {
    }

    public record SourceRange(String location, Position start, Position end) {
    }

    /**
     * Represents the type of a variable.
     * 
     * @param line     the line number of the variable declaration
     * @param character   the column number of the variable declaration
     * @param name     the name of the variable
     * @param type     the inferred type of the variable
     * @param nodeKind the kind of AST node that declares the variable (e.g.,
     *                 "ForVariableDeclaration", "LetVariableDeclaration", etc.)
     */
    public record VariableType(
            Position position,
            String name,
            String type,
            String nodeKind) {
    }

    /**
     * Represents the type of a function.
     * 
     * @param line           the line number of the function declaration
     * @param character         the column number of the function declaration
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
            SourceRange range) {
    }

    public record InferenceResult(
            List<VariableType> variableTypes,
            List<FunctionType> functionTypes,
            List<TypeError> typeErrors,
            String error) {
    }

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

    public InferenceResult infer(String query) {
        if (query == null || query.isEmpty()) {
            return new InferenceResult(List.of(), List.of(), List.of(), null);
        }

        List<VariableType> variableTypes = new ArrayList<>();
        List<FunctionType> functionTypes = new ArrayList<>();
        List<TypeError> typeErrors = new ArrayList<>();
        String errorMessage = null;

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
            errorMessage = Objects.toString(throwable.getMessage(), throwable.getClass().getName());
        }

        /// Parse with strict configuration to collect type errors, if any.
        try {
            VisitorHelpers.parseMainModuleFromQuery(query, this.strictConfiguration);
        } catch (UnexpectedStaticTypeException exception) {
            typeErrors.add(toTypeError(exception));
            if (errorMessage == null) {
                errorMessage = Objects.toString(exception.getMessage(), exception.getClass().getName());
            }
        } catch (Throwable throwable) {
            if (errorMessage == null) {
                errorMessage = Objects.toString(throwable.getMessage(), throwable.getClass().getName());
            }
        }

        return new InferenceResult(variableTypes, functionTypes, typeErrors, errorMessage);
    }

    private static TypeError toTypeError(UnexpectedStaticTypeException exception) {
        ExceptionMetadata metadata = exception.getMetadata() == null
                ? ExceptionMetadata.EMPTY_METADATA
                : exception.getMetadata();
        String code = exception.getErrorCode();
        String message = Objects.toString(exception.getJSONiqErrorMessage(), exception.getMessage());
        SourceRange range = chooseBestErrorRange(metadata);
        return new TypeError(
                code,
                message,
                range.location(),
                range);
    }

    private static SourceRange chooseBestErrorRange(ExceptionMetadata metadata) {
        int startLine = Math.max(1, metadata.getTokenLineNumber());
        int startColumn = Math.max(0, metadata.getTokenColumnNumber());
        return new SourceRange(
                Objects.toString(metadata.getLocation(), ""),
                new Position(startLine, startColumn),
                new Position(startLine, startColumn + 1));
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

        int line = metadata.getTokenLineNumber();
        int column = metadata.getTokenColumnNumber();

        Map<String, String> parameterTypes = new LinkedHashMap<>();
        functionExpression.getParams().forEach((name, type) -> {
            String parameterName = name.getLocalName() == null ? name.toString() : name.getLocalName();
            String parameterType = type == null ? "item*" : type.toString();
            parameterTypes.put("$" + parameterName, parameterType);
            addVariableTypeFromContext(
                    functionExpression.getStaticContext(),
                    name,
                    "FunctionParameterDeclaration",
                    variableTypes);
        });

        SequenceType returnType = functionExpression.getReturnType();
        if (returnType == null) {
            returnType = SequenceType.createSequenceType("item*");
        }

        functionTypes.add(new FunctionType(
                new Position(line, column),
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
                    "ForVariableDeclaration",
                    variableTypes);

            // Positional variable is optional, so we check if it exists before trying to
            // add its type
            Name positionalVariableName = forClause.getPositionalVariableName();
            if (positionalVariableName != null) {
                addVariableTypeFromContext(
                        typeContext,
                        positionalVariableName,
                        "ForPositionalVariableDeclaration",
                        variableTypes);
            }
            return;
        }

        if (clause instanceof LetClause letClause) {
            addVariableTypeFromContext(
                    typeContext,
                    letClause.getVariableName(),
                    "LetVariableDeclaration",
                    variableTypes);
            return;
        }

        if (clause instanceof CountClause countClause) {
            addVariableTypeFromContext(
                    typeContext,
                    countClause.getCountVariableName(),
                    "CountVariableDeclaration",
                    variableTypes);
            return;
        }

        if (clause instanceof GroupByClause groupByClause) {
            for (GroupByVariableDeclaration groupByVariable : groupByClause.getGroupVariables()) {
                addVariableTypeFromContext(
                        typeContext,
                        groupByVariable.getVariableName(),
                        "GroupByVariableDeclaration",
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
                new Position(metadata.getTokenLineNumber(), metadata.getTokenColumnNumber()),
                variableName.toString(),
                variableType.toString(),
                "DeclareVariableDeclaration"));
    }

    /**
     * Adds a variable type to the list of variable types based on the static
     * context and variable name.
     * 
     * @param context       the static context to retrieve the variable type from
     * @param variableName  the name of the variable to retrieve the type for
     * @param nodeKind      the kind of AST node that declares the variable (e.g.,
     *                      "ForVariableDeclaration")
     * @param variableTypes the list to add the variable type to
     * @return true if the variable type was successfully added, false otherwise
     */
    private static boolean addVariableTypeFromContext(
            StaticContext context,
            Name variableName,
            String nodeKind,
            List<VariableType> variableTypes) {
        if (context == null || variableName == null) {
            return false;
        }

        try {
            SequenceType variableType = context.getVariableSequenceType(variableName);
            ExceptionMetadata metadata = context.getVariableMetadata(variableName);
            int line = metadata.getTokenLineNumber();
            int column = metadata.getTokenColumnNumber();

            variableTypes
                    .add(new VariableType(new Position(line, column), variableName.toString(), variableType.toString(),
                            nodeKind));
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }
}
