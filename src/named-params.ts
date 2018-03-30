// tslint:disable
const PARAMETER_SEPARATORS = ['"', '\'', ':', '&', ',', ';', '(', ')', '|', '=', '+', '-', '*', '%', '/', '\\', '<', '>', '^'];

export interface NamedParam {
    name: string;
    index: number;
    indexes: number[];
}

export interface ParsedSql {
    sql: string;
    originalSql: string;
    params: NamedParam[];
    numParams: number;
    numDistinctParams: number;
}

const SKIPS = [
    {
        start: "'",
        stop: "'"
    }, {
        start: '"',
        stop: '"'
    }, {
        start: '--',
        stop: '\n'
    }, {
        start: '/*',
        stop: '*/'
    }
];

function isParamSeparator(c: string) {
    return /\s/.test(c) || PARAMETER_SEPARATORS.indexOf(c) >= 0;
}

function skipCommentsAndQuotes(sql: string, position: number) {
    let k: number;
    let len: number;
    let skip: { start: string, stop: string };
    for (k = 0, len = SKIPS.length; k < len; k++) {
        skip = SKIPS[k];
        if (sql.substr(position, skip.start.length) !== skip.start) {
            continue;
        }
        position += skip.start.length;
        while (sql.substr(position, skip.stop.length) !== skip.stop) {
            position++;
            if (position >= sql.length) {
                return sql.length;
            }
        }
        position += skip.stop.length;
    }
    return position;
}

export function parse(sql: string): ParsedSql {
    let i: number;
    let j: number;
    let k: number;
    let l: number;
    let len: number;
    let namedParam: any;
    let namedParams: any;
    let param: any;
    let paramCount: any;
    let paramTypes: any;
    let params: any[];
    let ref: string;
    let ref1: string;
    let ref2: number;
    let skipPos;
    if (typeof sql !== 'string') {
        throw new Error('sql must be a string');
    }
    params = [];
    i = 0;
    function throwError(msg: string, pos: number) {
        pos = pos || i;
        throw new Error((msg || 'Error') + ' at position ' + pos + ' in statment ' + sql);
    };
    while (i < sql.length) {
        skipPos = i;
        while (i < sql.length) {
            skipPos = skipCommentsAndQuotes(sql, i);
            if (i === skipPos) {
                break;
            }
            i = skipPos;
        }
        if (i >= sql.length) {
            break;
        }
        if ((ref = sql[i]) === ':' || ref === '&' || ref === '$') {
            if (sql.substr(i, 2) === '::') {
                i += 2;
                continue;
            }
            j = i + 1;
            if (sql.substr(i, 2) === ':{') {
                while (j < sql.length && '}' !== sql[j]) {
                    j++;
                    if ((ref1 = sql[j]) === ':' || ref1 === '{') {
                        throwError('Parameter name contains invalid character "' + sql[j] + '"', j);
                    }
                }
                if (j >= sql.length) {
                    throwError('Non-terminated named parameter declaration)', j);
                }
                if (j - i > 3) {
                    params.push({
                        name: sql.substring(i + 2, j),
                        start: i,
                        end: j + 1,
                        type: ':{}'
                    });
                }
                j++;
            } else {
                while (j < sql.length && !isParamSeparator(sql[j])) {
                    j++;
                }
                if ((j - i) > 1) {
                    params.push({
                        name: sql.substring(i + 1, j),
                        start: i,
                        end: j,
                        type: sql[i]
                    });
                }
            }
            i = j - 1;
        }
        i++;
    }
    const ret: ParsedSql = {
        sql,
        originalSql: sql,
        params: [],
        numParams: params.length,
        numDistinctParams: 0
    };
    paramTypes = {};
    namedParams = {};
    paramCount = 0;
    for (k = 0, len = params.length; k < len; k++) {
        param = params[k];
        paramCount++;
        paramTypes[param.type] = (paramTypes[param.type] || 0) + 1;
        if (/^[0-9]+$/.test(param.name)) {
            throwError('You cannot mix named and numbered parameters. Check parameter "' + param.name + '"', param.start);
        }
        namedParam = namedParams[param.name];
        if (!namedParam) {
            ret.numDistinctParams++;
            namedParam = {
                name: param.name,
                index: ret.numDistinctParams,
                indexes: []
            };
            namedParams[param.name] = namedParam;
            ret.params.push(namedParam);
        }
        namedParam.indexes.push(paramCount);
    }
    if (Object.keys(paramTypes).length > 1) {
        throw new Error('You cannot mix multiple types of parameters in statement: ' + sql);
    }
    if (ret.numParams > 0) {
        for (i = l = ref2 = ret.numParams - 1; ref2 <= 0 ? l <= 0 : l >= 0; i = ref2 <= 0 ? ++l : --l) {
            param = params[i];
            namedParam = namedParams[param.name];
            ret.sql = ret.sql.substring(0, param.start) + '$' + namedParam.index + ret.sql.substring(param.end);
        }
    }
    return ret;
}

export interface NamedParams {
    [key: string]: any;
    forEach?: void;
};

export function convertParamValues(parsedSql: ParsedSql, values: NamedParams): any[] {
    let k: number;
    let len: number;
    let param: any;
    let ref: any;
    const ret: any[] = [];
    ref = parsedSql.params;
    for (k = 0, len = ref.length; k < len; k++) {
        param = ref[k];
        if (param.name in values) {
            ret.push(values[param.name]);
        } else {
            throw new Error('No value found for parameter: ' + param.name);
        }
    }
    return ret;
}
